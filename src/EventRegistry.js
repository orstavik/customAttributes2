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
  }
});

class NativeBubblingAttribute extends Attr {
  static #reroute = function (e) {
    // e.preventDefault(); // if dispatchEvent propagates sync, native defaultActions can still be used.
    e.stopImmediatePropagation();
    customEvents.dispatch(e, e.composedPath()[0]);
  };

  upgrade() {
    this.ownerElement.addEventListener(this.constructor.prefix, NativeBubblingAttribute.#reroute);
  }

  destructor() {
    for (let o of this.ownerElement.attributes)
      if (this.constructor.prefix === o.constructor.prefix && o !== this)
        return;
    this.ownerElement.removeEventListener(this.constructor.prefix, NativeBubblingAttribute.#reroute);
  }

  static subclass(prefix) {
    if (!(`on${prefix}` in HTMLElement.prototype && `on${prefix}` in window))
      return;
    return class NativeBubblingAttributeImpl extends NativeBubblingAttribute {
      static get prefix() {
        return prefix;
      }

      static get suffix() {
        return "";
      }
    };
  }
}


class NativeNonBubblingAttribute extends Attr {
  static subclass(prefix) {
    if (!(`on${prefix}` in window) || `on${prefix}` in HTMLElement.prototype)
      return;
    return class NativeNonBubblingAttributeImpl extends Attr {

      static #rerouter = function reroute(e) {
        customEvents.dispatch(e);
        if (!customEvents.count(e.type))
          window.removeEventListener(this.prefix, this.#rerouter);
      }.bind(this);

      upgrade() {
        window.addEventListener(this.constructor.prefix, this.constructor.#rerouter);
      }

      static get prefix() {
        return prefix;
      }

      static get suffix() {
        return "";
      }
    };
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
    return class SuffixedCustomAttr extends aCustomAttrDefinition {
      static get prefix() {
        return prefix;
      }

      static get suffix() {
        return suffix;
      }
    };
  }

  define(prefix, Class) {
    const overlapDefinition = this.prefixOverlaps(prefix);
    if (overlapDefinition)
      throw `The customEvent "${prefix}" is already defined as "${overlapDefinition}".`;
    if (Class.prefix)
      throw `${Class.name} definition is already used (${Class.name}.prefix === "${Class.prefix}"). 
    What about 'customEvents.define("${prefix}", class Something extends ${Class.name}{});'?`;
    Object.defineProperties(Class, {
      "prefix": {
        get: function () {
          return prefix;
        }
      }, "suffix": {
        get: function () {
          return "";
        }
      }
    });
    this[prefix] = Class;
    this.#upgradeUnknownEvents(prefix, Class);
  }

  getName(Class) {
    for (let name in this)
      if (this[name] === Class)
        return name;
  }

  suffixDefinition(name) {
    const prefix = Object.keys(this).find(prefix => this[prefix] && name.startsWith(prefix));
    return prefix && EventRegistry.makeSuffixDefinition(this[prefix], prefix, name.substring(prefix.length));
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

  #upgradeAttribute(at, Definition) {
    Object.setPrototypeOf(at, Definition.prototype);
    try {
      at.upgrade?.();
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

  count(name) {              //todo this doesn't work.
    return this.#allAttributes[name].length;
  }

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
      if (target instanceof Element) {  //todo there is a bug from the ElementObserver.js so that instanceof HTMLElement doesn't work.
        for (let t = target; t; t = t.assignedSlot || t.parentElement || t.parentNode?.host) {
          for (let attr of t.attributes)
            if (attr.event === event.type)
              customEventFilters.callFilter(attr, event);
        }
        if (event.defaultAction && !event.defaultPrevented) {
          customEventFilters.callDefaultAction(event.defaultAction, event);
          if (event.defaultAction.once)
            event.defaultAction.ownerElement.removeAttribute(event.defaultAction.name);
        }
      } else if (target instanceof Attr) {                     //target is a single attribute, then call only that attribute.
        customEventFilters.callFilter(target, event);
      } else if (!target) {                                    //there is no target, then broadcast to all attributes with that name
        for (let attr of this.#allAttributes[event.type])
          customEventFilters.callFilter(attr, event);
      }
      this.#eventLoop.shift();
    }
  }
}

window.customEvents = new EventRegistry();