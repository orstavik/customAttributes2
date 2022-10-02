Object.defineProperties(Attr.prototype, {
  "event": {
    get: function () {
      const parts = this.name.split(":");
      return parts[0] || parts[1];
    }
  }, "prefix": {
    get: function () {
      return this.event.split("_")[0];
    }
  }, "suffix": {
    get: function () {
      return this.event.split("_").slice(1);
    }
  }, "filterFunction": {
    get: function () {
      const res = this.name.split("::")[0].substring(this.event.length);
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
  upgrade() {
    this._listener = this.listener.bind(this);
    this.ownerElement.addEventListener(this.prefix, this._listener);
  }

  listener(e) {
    // e.preventDefault(); // if dispatchEvent propagates sync, native defaultActions can still be used.
    e.stopImmediatePropagation();
    customEvents.dispatch(e, e.composedPath()[0]);
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
        customEvents.dispatch(e, at) :
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
        customEvents.dispatch(e, at) :
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
        customEvents.dispatch(new ErrorEvent("EventError", {error}), at.ownerElement);
      }
    }
  }

  upgrade(...attrs) {
    for (let at of attrs) {
      const Definition = this[at.prefix] ??= getNativeEventDefinition(at.prefix);
      Definition ? this.#upgradeAttribute(at, Definition) : this.#unknownEvents.push(at.prefix, at);
    }
  }

  //todo
  // If we add an event reaction, that should be passive, then we should add this as a
  // 1. a special filter on the special native pointerdown and wheel? There are few passive possible events? This should be a special class actually..
  #upgradeAttribute(at, Definition) {
    Object.setPrototypeOf(at, Definition.prototype);
    try {
      at.upgrade?.();
      at.changeCallback?.();
    } catch (error) {
      customEvents.dispatch(new ErrorEvent("EventError", {error}), at.ownerElement);
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
            if (attr.prefix === event.type) {
              if (!event.defaultPrevented || !attr.defaultAction) {            //todo 1.
                if (attr.defaultAction && event.defaultAction)
                  continue;
                const res = this.callFilterImpl(attr.filterFunction, attr, event);
                if (res !== undefined && attr.defaultAction)
                  event.defaultAction = {attr, res};
              }                                                                 //todo 1.
            }
          }
        }
        if (event.defaultAction) {
          const {attr, res} = event.defaultAction;
          if (!event.defaultPrevented)                                                        //todo 1.
            this.callFilterImpl(attr.defaultAction, attr, res);
        }
        //single-attribute propagation
      } else if (target instanceof Attr) {
        this.callFilterImpl(target.allFunctions, target, event);
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