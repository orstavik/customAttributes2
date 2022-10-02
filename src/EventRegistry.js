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

Object.defineProperties(Attr.prototype, {
  "event": {
    get: function () {
      return (this.name.split(":"))[0];
    }
  }, "prefix": {
    get: function () {
      return this.event.split("_")[0];
    }
  }, "suffix": {
    get: function () {
      return this.event.split("_").slice(1);
    }
  }, "filterFunction": { //todo add the customEventFilters.
    get: function () {
      const res = this.name.split("::")[0].substring(this.event.length);
      const res2 = res.substring(1).split(":").map(f => f.split("_"));
      return customEventFilters.getFilterFunctions(res2);
    }
  }, "defaultAction": {  //todo
    get: function () {
      let da = this.name.split("::")[1] || "";
      da = da.split(":").map(f => f.split("_"));
      return customEventFilters.getFilterFunctions(da);
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
      at && at.ownerElement ?                                         //todo we have a GC leak here.
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
  const Definition =
    // prefix === "passivewheel" ? PassiveNativeBubblingEvent :  //todo
    `on${prefix}` in HTMLElement.prototype ? NativeBubblingEvent :
      `on${prefix}` in window ? NativeWindowOnlyEvent :
        `on${prefix}` in Document.prototype && NativeDocumentOnlyEvent;
  return Definition;
}

class UnsortedWeakArray {
  push(event, el) {
    (this[event] ??= []).push(new WeakRef(el));
  }

  * attributes(event) {
    const ar = this[event] || [];
    for (let i = 0; i < ar.length; i++) {
      let ref = ar[i];
      const res = ref.deref();
      if (res === undefined) {           //or if res.ownerElement === null, then it has been removed from the DOM.
        ar[i--] = ar[ar.length - 1];
        ar.pop();
      } else
        yield res;
    }
    delete this[event];
  }
}

class EventRegistry {

  #unknownEvents = new UnsortedWeakArray();

  define(prefix, Definition) {
    if (this[prefix])
      throw `The customEvent "${prefix}" is already defined.`;
    this[prefix] = Definition;
    for (let at of this.#unknownEvents.attributes(prefix)) {
      try {
        this.#upgradeAttribute(at, Definition);
      } catch (error) {
        eventLoop.dispatch(new ErrorEvent("EventError", {error}), at.ownerElement);
      }
    }
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
      if (target instanceof Element)   //todo there is a bug from the ElementObserver.js so that instanceof HTMLElement doesn't work.
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
          if (!event.defaultPrevented || !attr.defaultAction.length) {            //todo 1.
            if (attr.defaultAction.length && event.defaultAction)
              continue;
            const res = EventLoop.callFilterImpl(attr.filterFunction, attr, event);
            if (res !== undefined && attr.defaultAction.length)
              event.defaultAction = {attr, res};
          }                                                                 //todo 1.
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