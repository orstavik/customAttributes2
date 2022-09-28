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
  }, "suffix": {
    get: function(){
      return this.constructor === Attr ? '' : this.event.substring(this.constructor.prefix.length);
    }
  }
});

class NativeBubblingAttribute extends Attr {
  upgrade() {
    this.ownerElement.addEventListener(this.constructor.prefix, this.reroute);
  }

  destructor() {
    for (let o of this.ownerElement.attributes)
      if (this.constructor.prefix === o.constructor.prefix && o !== this)
        return;
    this.ownerElement.removeEventListener(this.constructor.prefix, this.reroute);
  }

  reroute(e) {
    // e.preventDefault(); // if dispatchEvent propagates sync, native defaultActions can still be used.
    e.stopImmediatePropagation();
    customEvents.dispatch(e, e.composedPath()[0]);
  }

  get suffix() {
    return "";
  }

  static bubblingEvent(prefix) {
    return `on${prefix}` in HTMLElement.prototype && `on${prefix}` in window;
  }

  static subclass(prefix) {
    if (this.bubblingEvent(prefix))
      return class NativeBubblingAttributeImpl extends NativeBubblingAttribute {
        static get prefix() {
          return prefix;
        }
        get suffix(){
          return "";
        }
      };
  }
}

class NativeNonBubblingAttribute extends Attr {

  static nonBubblingEvent(prefix) {
    return `on${prefix}` in window && !(`on${prefix}` in HTMLElement.prototype);
  }

  static subclass(prefix) {
    if (this.nonBubblingEvent(prefix))
      return class NativeNonBubblingAttributeImpl extends Attr {

        static #rerouter = this.reroute.bind(this);

        static reroute(e) {
          customEvents.dispatch(e);
          if (!customEvents.count(e.type))
            window.removeEventListener(this.prefix, this.constructor.#rerouter);
        }

        upgrade() {
          window.addEventListener(this.constructor.prefix, this.constructor.#rerouter);
        }

        static get prefix() {
          return prefix;
        }

        get suffix() {                                       //todo this should be static, because this is a static property.
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

  define(prefix, Class) {
    const overlapDefinition = this.prefixOverlaps(prefix);
    if (overlapDefinition)
      throw `The customEvent "${prefix}" is already defined as "${overlapDefinition}".`;
    if (Class.prefix)
      throw `${Class.name} definition is already used (${Class.name}.prefix === "${Class.prefix}"). 
    What about 'customEvents.define("${prefix}", class Something extends ${Class.name}{});'?`;
    Class.prefix = prefix;
    this[prefix] = Class;
    this.#upgradeUnknownEvents(prefix, Class);
  }

  getName(Class) {
    for (let name in this)
      if (this[name] === Class)
        return name;
  }

  find(name) {
    if (this[name] ??= NativeBubblingAttribute.subclass(name) || NativeNonBubblingAttribute.subclass(name))
      return this[name];
    for (let def in this)
      if (this[def] && name.startsWith(def))
        return this[def];
  }

  upgrade(...attrs) {
    for (let at of attrs) {
      (this.#allAttributes[at.event] ??= new UnsortedWeakArray()).push(at);
      const Definition = this.find(at.event);
      Definition ?
        this.#upgradeAttribute(at, Definition) :
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

  count(name) {
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
        for (let at of this.#allAttributes[event])
          this.#upgradeAttribute(at, Definition);
        delete this.#upgradeUnknownEvents[event];
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
          if(event.defaultAction.once)
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