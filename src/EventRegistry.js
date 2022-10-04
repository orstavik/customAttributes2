class EventFilterRegistry {
  define(prefix, Function) {
    if (/^(async |)(\(|[^([]+=)/.test(Function.toString()))
      throw `Arrow functions cannot be bound as customEventFilters.`;
    const usedFilterName = Object.keys(this).find(name => this[name] === Function);
    if (usedFilterName === prefix)
      return console.warn(`Defining the event filter "${prefix}" multiple times.`);
    if (usedFilterName)
      throw `Function: "${Function.name}" is already defined as event filter "${usedFilterName}".`;
    const overlapDefinition = Object.keys(this).find(old => prefix.startsWith(old) || old.startsWith(prefix));
    if (overlapDefinition)
      throw `The eventFilter prefix: "${prefix}" is already defined as "${overlapDefinition}".`;
    this[prefix] = Function;
  }

  #cache = {};
  #empty = [];

  getFilterFunctions(filters) {
    if (!filters)
      return this.#empty;
    if (this.#cache[filters])
      return this.#cache[filters];
    const res = [];
    for (let [prefix, ...suffix] of filters.split(":").map(str => str.split("_"))) {
      if (!prefix)  //ignore empty
        continue;
      const Definition = this[prefix];
      if (!Definition)
        return [];
      res.push({Definition, prefix, suffix});
    }
    return this.#cache[filters] = res;
  }
}

window.customEventFilters = new EventFilterRegistry();

//Some CustomAttr lookups are used frequently!
//1. the prefix is checked every time the attribute is passed by for an event in the DOM.
//2. the suffix is used only once per attribute.
//3. The filterFunction(), defaultAction() and allFunctions() are used every time they are called.
class CustomAttr extends Attr {
  get suffix() {
    return this.name.match(/_?([^:]+)/)[1].split("_").slice(1);
  }

  get filterFunction() {  //checked for many listeners for same type of event
    const value = this.name.substring(this.name.indexOf(":")).split("::")[0];
    Object.defineProperty(this, "filterFunction", {get: function(){return value;}});
    return value;
  }

  get defaultAction() {  //checked for many listeners for same type of event
    const value = this.name.split("::")[1];
    Object.defineProperty(this, "defaultAction", {get: function(){return value;}});
    return value;
  }

  get allFunctions() {   //checked for many listeners for same type of event
    const value = this.name.substring(this.name.indexOf(":"));
    Object.defineProperty(this, "allFunctions", {get: function(){return value;}});
    return value;
  }

  static prefix(attr) {
    const value = attr.name.match(/_?([^_:]+)/)[1];
    Object.defineProperty(attr, "prefix", {get: function(){return value;}}); //we should restrict .name and all other properties from being redefined.
    return value;
  }
}

class NativeBubblingEvent extends CustomAttr {
  upgrade() {
    this._listener = this.listener.bind(this);
    this.ownerElement.addEventListener(this.prefix, this._listener);
  }

  listener(e) {
    // e.preventDefault(); // if dispatchEvent propagates sync, native defaultActions can still be used.
    e.stopImmediatePropagation();
    eventLoop.dispatch(e, e.composedPath()[0]);
  }

  destructor() {
    this.ownerElement.removeEventListener(this.prefix, this._listener);
  }
}

class NativeDocumentOnlyEvent extends CustomAttr {
  upgrade() {
    const prefix = this.prefix;
    const attr = new WeakRef(this);
    const reroute = function (e) {
      const at = attr.deref();
      at && at.ownerElement ? //todo GC leak here. If the element is removed from the dom, but not yet GC, then this callback will still trigger.
        eventLoop.dispatch(e, at) :
        document.removeEventListener(prefix, reroute);
    }
    document.addEventListener(prefix, reroute);
  }
}

class NativeWindowOnlyEvent extends CustomAttr {
  upgrade() {
    const prefix = this.prefix;
    const attr = new WeakRef(this);
    const reroute = function (e) {
      const at = attr.deref();
      at && at.ownerElement ?                                       //todo we have a GC leak here.
        eventLoop.dispatch(e, at) :
        window.removeEventListener(prefix, reroute);
    }
    window.addEventListener(prefix, reroute);
  }
}

//todo
class PassiveNativeBubblingEvent extends NativeBubblingEvent {
  upgrade() {
    super.upgrade();
    this.ownerElement.addEventListener(this.prefix, this._passiveListener = () => 1);
  }

  destructor() {
    //todo the destructor is safe, no? There will not be any possibility of removing the attribute from the element without
    // the destructor being called? Yes, it is safe for this purpose, but the element can be removed from the DOM without the destructor being called.
    this.ownerElement.addEventListener(this.prefix, this._passiveListener);
    super.destructor();
  }
}

function getNativeEventDefinition(prefix) {
  // prefix === "passivewheel" ? PassiveNativeBubblingEvent :  //todo
  return `on${prefix}` in HTMLElement.prototype ? NativeBubblingEvent :
    `on${prefix}` in window ? NativeWindowOnlyEvent :
      `on${prefix}` in Document.prototype && NativeDocumentOnlyEvent;
}

class WeakArrayDict {
  push(key, value) {
    (this[key] ??= []).push(new WeakRef(value));
  }

  * values(key) {
    for (let ref of this[key] || []) {
      const v = ref.deref();
      if (v?.ownerElement) //if no .ownerElement, the attribute has been removed from DOM but not yet GC.
        yield v;
    }
    delete this[key];
  }
}

class EventRegistry {

  #unknownEvents = new WeakArrayDict();

  define(prefix, Definition) {
    if (this[prefix])
      throw `The customEvent "${prefix}" is already defined.`;
    this[prefix] = Definition;
    for (let at of this.#unknownEvents.values(prefix))
      this.#upgradeAttribute(at, Definition);
  }

  upgrade(...attrs) {
    for (let at of attrs) {
      const prefix = CustomAttr.prefix(at);
      const Definition = this[prefix] ??= getNativeEventDefinition(prefix);
      if (Definition)                                           //1. upgrade to a defined CustomAttribute
        this.#upgradeAttribute(at, Definition)
      else {
        if (at.name.indexOf(":") > 0)                           //2. upgrade to the generic CustomAttribute, as it enables event listeners.
          Object.setPrototypeOf(at, CustomAttr.prototype);      //   this enables reactions to events with the given name.
        this.#unknownEvents.push(prefix, at);                   //
      }
    }
  }

  #upgradeAttribute(at, Definition) {
    Object.setPrototypeOf(at, Definition.prototype);
    try {
      at.upgrade?.();
    } catch (error) {
      Object.setPrototypeOf(at, CustomAttr.prototype);
      eventLoop.dispatch(new ErrorEvent("EventError", {error}), at.ownerElement);
    }
    try {
      at.changeCallback?.();
    } catch (error) {
      eventLoop.dispatch(new ErrorEvent("EventError", {error}), at.ownerElement);
    }
  }
}

window.customEvents = new EventRegistry();

class EventLoop {
  #eventLoop = [];

  dispatch(event, target) {
    if(event.type[0] === "_")
      throw new Error(`eventLoop.dispatch(..) doesn't accept events beginning with "_": ${event.type}.`);
    this.#eventLoop.push({target, event});
    if (this.#eventLoop.length > 1)
      return;
    while (this.#eventLoop.length) {
      const {target, event} = this.#eventLoop[0];
      if (target instanceof Element)   //a bug in the ElementObserver.js causes "instanceof HTMLElement" to fail.
        EventLoop.bubble(target, event);
      else if (target instanceof Attr)
        EventLoop.callFilterImpl(target.allFunctions, target, event);
      this.#eventLoop.shift();
    }
  }

  static bubble(target, event) {
    for (let t = target; t; t = t.assignedSlot || t.parentElement || t.parentNode?.host) {
      for (let attr of t.attributes) {
        if (attr.prefix === event.type) {//todo attr.name.startsWith(event.type+":") || attr.name.startsWith(event.type+"_") instead??
          if (attr.defaultAction && (event.defaultAction || event.defaultPrevented))
            continue;
          const res = EventLoop.callFilterImpl(attr.filterFunction, attr, event);
          if (res !== undefined && attr.defaultAction)
            event.defaultAction = {attr, res};
        }
      }
    }
    //todo run _global listeners here??
    if (event.defaultAction && !event.defaultPrevented) {
      const {attr, res} = event.defaultAction;
      EventLoop.callFilterImpl(attr.defaultAction, attr, res);
    }
  }

  static callFilterImpl(filters, at, event) {
    for (let {Definition, prefix, suffix} of customEventFilters.getFilterFunctions(filters)) {
      try {
        event = Definition.call(at, event, prefix, ...suffix);
      } catch (error) {
        eventLoop.dispatch(new ErrorEvent("FilterError", {error}), at.ownerElement);
        return;
      }
      if (event === undefined)
        return;
    }
    return event;
  }
}

window.eventLoop = new EventLoop();