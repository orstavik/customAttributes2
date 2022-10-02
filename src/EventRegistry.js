Object.defineProperties(Attr.prototype, {
  "once": {
    get: function () {
      return this.name[0] === ":";
    }
  }, "event": {
    get: function () {
      const parts = this.name.split(":");
      return parts[0] || parts[1];
    }
  }, "filterFunction": {
    get: function () {
      const res = this.name.split("::")[0].substring(this.once + this.event.length);
      if (res.length > 1)
        return res.substring(1);
    }
  }, "defaultAction": {
    get: function () {
      return this.name.split("::")[1];
    }
  }, "allFunctions": {
    get: function () {
      return !this.defaultAction ? this.filterFunction : !this.filterFunction ? this.defaultAction : this.filterFunction + ":" + this.defaultAction;
    }
  }
});

class NativeBubblingEvent extends Attr {
  static #reroute = function (e) {
    // e.preventDefault(); // if dispatchEvent propagates sync, native defaultActions can still be used.
    e.stopImmediatePropagation();
    customEvents.dispatch(e, e.composedPath()[0]);
  };

  upgrade(prefix) {
    this.ownerElement.addEventListener(this._prefix = prefix, NativeBubblingEvent.#reroute);
  }

  destructor() {
    for (let o of this.ownerElement.attributes)
      if (this.constructor === o.constructor && o !== this && this._prefix === o._prefix)
        return;
    this.ownerElement.removeEventListener(this._prefix, NativeBubblingEvent.#reroute);
  }
}

class NativeDocumentOnlyEvent extends Attr {
  upgrade(prefix) {
    const owner = new WeakRef(this);
    const reroute = function (e) {
      const target = owner.deref();
      target ?
        customEvents.dispatch(e, target) :
        document.removeEventListener(prefix, reroute);
    }
    document.addEventListener(prefix, reroute);
  }
}

class NativeWindowOnlyEvent extends Attr {
  upgrade(prefix) {
    const owner = new WeakRef(this);
    const reroute = function (e) {
      const target = owner.deref();
      target && target.ownerElement ?
        customEvents.dispatch(e, target) :
        window.removeEventListener(prefix, reroute);
    }
    window.addEventListener(prefix, reroute);
  }
}

function getNativeEventDefinition(prefix) {
  const Definition =
    `on${prefix}` in HTMLElement.prototype ? NativeBubblingEvent :
      `on${prefix}` in window ? NativeWindowOnlyEvent :
        `on${prefix}` in Document.prototype && NativeDocumentOnlyEvent;
  return Definition && {Definition, prefix, suffix: []};
}

class UnsortedWeakArray extends Array {
  push(el) {
    super.push(new WeakRef(el));
  }

  * [Symbol.iterator]() {
    for (let i = 0; i < this.length; i++) {
      let ref = this[i];
      const res = ref.deref();
      if (res === undefined) {           //or if res.ownerElement === null, then it has been removed from the DOM.
        this[i--] = this[this.length - 1];
        this.pop();
      } else
        yield res;
    }
  }
}

class EventRegistry {

  #unknownEvents = [];

  static parseSuffix(suffix) {
    return suffix === "" ? [] : suffix[0] === "_" ? suffix.substring(1).split("_") : [suffix];
  }

  define(prefix, Class) {
    const overlapDefinition = this.prefixOverlaps(prefix);
    if (overlapDefinition)
      throw `The customEvent "${prefix}" is already defined as "${overlapDefinition}".`;
    this[prefix] = {prefix, suffix: [], Definition: Class};
    this.#upgradeUnknownEvents(prefix, Class);
  }

  suffixDefinition(name) {
    const prefix = Object.keys(this).find(prefix => this[prefix] && name.startsWith(prefix));
    if (prefix)
      return {
        Definition: this[prefix].Definition,
        prefix,
        suffix: EventRegistry.parseSuffix(name.substring(prefix.length))
      };
  }

  upgrade(...attrs) {
    for (let at of attrs) {
      this[at.event] ??= getNativeEventDefinition(at.event) || this.suffixDefinition(at.event);
      this[at.event] ?
        this.#upgradeAttribute(at, this[at.event]) :
        (this.#unknownEvents[at.event] ??= new UnsortedWeakArray()).push(at);
    }
  }

  #upgradeAttribute(at, {Definition, suffix, prefix}) {
    Object.setPrototypeOf(at, Definition.prototype);
    try {
      at.upgrade?.(prefix, ...suffix);
      at.changeCallback?.();
    } catch (error) {
      customEvents.dispatch(new ErrorEvent("EventError", {error}), at.ownerElement);
    }
  }

  prefixOverlaps(newPrefix) {
    for (let oldPrefix in this)
      if (this[oldPrefix] && (newPrefix.startsWith(oldPrefix) || oldPrefix.startsWith(newPrefix)))
        return oldPrefix;
  }

  #upgradeUnknownEvents(prefix, Definition) {
    for (let event in this.#unknownEvents)
      if (event.startsWith(prefix)) {
        this[event] = {Definition, prefix, suffix: EventRegistry.parseSuffix(event.substring(prefix.length))};
        delete this.#upgradeUnknownEvents[event];
        for (let at of this.#unknownEvents[event]) //todo try catch here
          this.#upgradeAttribute(at, this[event]);
      }
  }

  //todo this should be in an EventLoop class actually. And this class could also hold the callFilter methods.
  //todo 1. the event loop class will make things a little simpler.
  //todo 2. then we need to work with the defaultAction methods in the callFilter methods.
  #eventLoop = [];

  dispatch(event, target) {
    this.#eventLoop.push({target, event});
    if (this.#eventLoop.length > 1)
      return;
    while (this.#eventLoop.length) {
      const {target, event} = this.#eventLoop[0];
      //bubble propagation
      if (target instanceof Element) {  //todo there is a bug from the ElementObserver.js so that instanceof HTMLElement doesn't work.
        for (let t = target; t; t = t.assignedSlot || t.parentElement || t.parentNode?.host) {
          for (let attr of t.attributes) {
            if (attr.event === event.type) {
              if (!event.defaultPrevented || !attr.defaultAction) {            //todo 1.
                if (attr.defaultAction && event.defaultAction)
                  continue;
                const res = this.callFilterImpl(attr.filterFunction, attr, event);
                if (res !== undefined && attr.defaultAction)
                  event.defaultAction = {attr, res};
                if (!attr.defaultAction && attr.once)
                  attr.ownerElement.removeAttribute(attr.name);
              }                                                                 //todo 1.
            }
            //todo
            // passive? This should probably be a special first filter ":passive".
            // This will add a special event listener with the passive argument set to true on the target node.
            // This would also need to be cleaned up.
          }
        }
        if (event.defaultAction) {
          const {attr, res} = event.defaultAction;
          if (!event.defaultPrevented)                                                        //todo 1.
            this.callFilterImpl(attr.defaultAction, attr, res);
          if (attr.once)
            attr.ownerElement.removeAttribute(attr.name);//todo 1.
        }
        //single-attribute propagation
      } else if (target instanceof Attr) {
        this.callFilterImpl(target.allFunctions, target, event);
        if (target.once)
          target.ownerElement.removeAttribute(target.name);
      }
      this.#eventLoop.shift();
    }
  }

  callFilterImpl(filter, at, event) {
    try {
      for (let {Definition, prefix, suffix} of customEventFilters.getFilterFunctions(filter) || []) {
        event = Definition.call(at, event, prefix, ...suffix);
        if (event === undefined)
          return;
      }
    } catch (error) {
      customEvents.dispatch(new ErrorEvent("FilterError", {error}), at.ownerElement);
      return;
    }
    return event;
  }
}

window.customEvents = new EventRegistry();