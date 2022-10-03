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

  getFilterFunctions(filters) {
    const res = [];
    for (let [prefix, ...suffix] of filters) {
      if (!this[prefix])
        return [];
      res.push({Definition: this[prefix], prefix, suffix});
    }
    return res;
  }
}

window.customEventFilters = new EventFilterRegistry();

function parse(attr){
  return attr.name.split("::").map(s=>s.split(":").map(s=>s.split("_")));
}

Object.defineProperties(Attr.prototype, {
  "prefix": {
    get: function () {
      return parse(this)[0][0][0];
    }
  }, "suffix": {
    get: function () {
      return parse(this)[0][0].slice(1);
    }
  }, "filterFunction": { //todo add the customEventFilters.
    get: function () {
      return customEventFilters.getFilterFunctions(parse(this)[0].slice(1) || []);
    }
  }, "defaultAction": {  //todo
    get: function () {
      return customEventFilters.getFilterFunctions(parse(this)[1] || []);
    }
  }, "allFunctions": {
    get: function () {
      return [...this.filterFunction, ...this.defaultAction];
    }
  }
});

class NativeBubblingEvent extends Attr {
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

class NativeDocumentOnlyEvent extends Attr {
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

class NativeWindowOnlyEvent extends Attr {
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
      const Definition = this[at.prefix] ??= getNativeEventDefinition(at.prefix);
      Definition ? this.#upgradeAttribute(at, Definition) : this.#unknownEvents.push(at.prefix, at);
    }
  }

  #upgradeAttribute(at, Definition) {
    Object.setPrototypeOf(at, Definition.prototype);
    try {
      at.upgrade?.();
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
        if (attr.prefix === event.type) {
          if (!event.defaultPrevented || !attr.defaultAction.length) {
            if (attr.defaultAction.length && event.defaultAction)
              continue;
            const res = EventLoop.callFilterImpl(attr.filterFunction, attr, event);
            if (res !== undefined && attr.defaultAction.length)
              event.defaultAction = {attr, res};
          }
        }
      }
    }
    if (event.defaultAction && !event.defaultPrevented) {
      const {attr, res} = event.defaultAction;
      EventLoop.callFilterImpl(attr.defaultAction, attr, res);
    }
  }

  static callFilterImpl(filters, at, event) {
    try {
      for (let {Definition, prefix, suffix} of filters) {
        event = Definition.call(at, event, prefix, ...suffix);
        if (event === undefined)
          return;
      }
    } catch (error) {
      eventLoop.dispatch(new ErrorEvent("FilterError", {error}), at.ownerElement);
      return;
    }
    return event;
  }
}

window.eventLoop = new EventLoop();