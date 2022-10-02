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

class NativeBubblingAttribute extends Attr {
  // static #reroute = function (e) {
  //   // e.preventDefault(); // if dispatchEvent propagates sync, native defaultActions can still be used.
  //   e.stopImmediatePropagation();
  //   customEvents.dispatch(e, e.composedPath()[0]);
  // };
  //
  // upgrade() {
  //   this.ownerElement.addEventListener(this.constructor.prefix, NativeBubblingAttribute.#reroute);
  // }
  //
  // destructor() {
  //   for (let o of this.ownerElement.attributes)
  //     if (this.constructor === o.constructor && o !== this)
  //       return;
  //   this.ownerElement.removeEventListener(this.constructor.prefix, NativeBubblingAttribute.#reroute);
  // }
  //
  static subclass(prefix) {
    if (!(`on${prefix}` in HTMLElement.prototype && `on${prefix}` in window))
      return;
    return {prefix, suffix: "", Definition: NativeBubblingEvent};
    // return class NativeBubblingAttributeImpl extends NativeBubblingAttribute {
    //   static get prefix() {
    //     return prefix;
    //   }
    //
    //   static get suffix() {
    //     return "";
    //   }
    // };
  }
}

class NativeBubblingEvent extends Attr {
  static #reroute = function (e) {
    // e.preventDefault(); // if dispatchEvent propagates sync, native defaultActions can still be used.
    e.stopImmediatePropagation();
    customEvents.dispatch(e, e.composedPath()[0]);
  };

  upgrade(prefix) { //todo make suffix ...variadic
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
      target && target.ownerElement ?   //remove the attribute from the dom or from the ownerElement, then it is lost.
        customEvents.dispatch(e, target) :
        window.removeEventListener(prefix, reroute);
    }
    window.addEventListener(prefix, reroute);
  }
}

//
// class NativeDomEvent extends Attr{
//   static #reroute = function (e) {
//     // e.preventDefault(); // if dispatchEvent propagates sync, native defaultActions can still be used.
//     e.stopImmediatePropagation();
//     customEvents.dispatch(e, e.composedPath()[0]);
//   };
//
//   upgrade(prefix) {
//     this.prefix = prefix;
//     this.ownerElement.addEventListener(prefix, NativeDomEvent.#reroute);
//   }
//
//   destructor() {
//     // for (let o of this.ownerElement.attributes)
//     //   if (this.constructor === o.constructor && o !== this)
//     //     return;
//     this.ownerElement.removeEventListener(this.prefix, NativeDomEvent.#reroute);
//   }
// }

class NativeNonBubblingAttribute extends Attr {
  static subclass(prefix) {
    if (!(`on${prefix}` in window) || `on${prefix}` in HTMLElement.prototype)
      return;
    return {prefix, suffix: "", Definition: NativeWindowOnlyEvent};
    //   return class NativeNonBubblingAttributeImpl extends Attr {
    //
    //     static #rerouter = function reroute(e) {
    //       customEvents.dispatch(e);
    //       if (!customEvents.count(e.type))
    //         window.removeEventListener(this.prefix, this.#rerouter);
    //     }.bind(this);
    //
    //     upgrade() {
    //       window.addEventListener(this.constructor.prefix, this.constructor.#rerouter);
    //     }
    //
    //     static get prefix() {
    //       return prefix;
    //     }
    //
    //     static get suffix() {
    //       return "";
    //     }
    //   };
  }
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
  #allAttributes = {};

  static makeSuffixDefinition(aCustomAttrDefinition, prefix, suffix) {
    if (suffix[0] === "_")
      suffix = suffix.substring(1).split("_");
    return {Definition: aCustomAttrDefinition, prefix, suffix};
  }

  define(prefix, Class) {
    const overlapDefinition = this.prefixOverlaps(prefix);
    if (overlapDefinition)
      throw `The customEvent "${prefix}" is already defined as "${overlapDefinition}".`;
    this[prefix] = {prefix, suffix: "", Definition: Class};
    this.#upgradeUnknownEvents(prefix, Class);
  }

  getName(Class) {
    for (let name in this)
      if (this[name] === Class)
        return name;
  }

  suffixDefinition(name) {
    const prefix = Object.keys(this).find(prefix => this[prefix] && name.startsWith(prefix));
    return prefix && EventRegistry.makeSuffixDefinition(this[prefix].Definition, prefix, name.substring(prefix.length));
  }

  upgrade(...attrs) {
    for (let at of attrs) {
      (this.#allAttributes[at.event] ??= new UnsortedWeakArray()).push(at);
      this[at.event] ??=
        NativeBubblingAttribute.subclass(at.event) ||
        NativeNonBubblingAttribute.subclass(at.event) ||
        this.suffixDefinition(at.event);
      this[at.event] ?
        this.#upgradeAttribute(at, this[at.event]) :
        this.#unknownEvents.push(at.event);
    }
  }

  #upgradeAttribute(at, {Definition, suffix, prefix}) {
    Object.setPrototypeOf(at, Definition.prototype);
    try {
      at.upgrade?.(prefix, suffix);
      at.changeCallback?.();
    } catch (error) {
      at.ownerElement.dispatchEvent(new ErrorEvent("error", {
        error,
        bubbles: true,
        composed: true,
        cancelable: true
      }));
      //any error that occurs during upgrade must be queued in the event loop.
    }
  }

  // count(name) {              //todo this doesn't work.
  //   return this.#allAttributes[name].length;
  // }
  //
  prefixOverlaps(newPrefix) {
    for (let oldPrefix in this)
      if (this[oldPrefix] && (newPrefix.startsWith(oldPrefix) || oldPrefix.startsWith(newPrefix)))
        return oldPrefix;
  }

  #upgradeUnknownEvents(prefix, Definition) {
    for (let event of this.#unknownEvents)
      if (event.startsWith(prefix)) {
        this[event] = EventRegistry.makeSuffixDefinition(Definition, prefix, event.substring(prefix.length));
        delete this.#upgradeUnknownEvents[event];
        for (let at of this.#allAttributes[event])
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
        //broadcast and single-attribute propagation
      } else if (target instanceof Attr) {
        // const attributes = target instanceof Attr ? [target] : this.#allAttributes[event.type];
        // for (let attr of attributes) {
        // if (!attr.ownerElement.isConnected)   //todo do we want this? or do we not want this? elements off the dom feels wrong.
        //   continue;
        const attr = target;
        this.callFilterImpl(attr.allFunctions, attr, event);
        if (attr.once)
          attr.ownerElement.removeAttribute(attr.name);
        // }
      }
      this.#eventLoop.shift();
    }
  }

  callFilterImpl(filter, at, event) {
    try {
      for (let {Definition, suffix, prefix} of customEventFilters.getFilterFunctions(filter) || []) {
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