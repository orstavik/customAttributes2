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
    e.composedPath()[0].dispatchEvent(e);
  }

  get suffix() {
    return "";
  }

  static bubblingEvent(prefix) {
    return `on${prefix}` in HTMLElement.prototype && `on${prefix}` in window;
  }

  static subclass(prefix) {
    if (!this.bubblingEvent(prefix))
      return;
    const Class = class NativeBubblingAttributeImpl extends NativeBubblingAttribute {
    };
    Class.prefix = prefix;
    return Class;
  }
}

// class NativeNonBubblingAttribute extends Attr {
//
//   upgrade() {
//     this.constructor.list.push(this);
//     if (this.constructor.list.length === 1)
//       window.addEventListener(this.constructor.prefix, this.reroute);
//   }
//
//   destructor() {
//     this.constructor.list.splice(this.constructor.list.indexOf(this), 1);
//     if (this.constructor.list.length === 0)
//       window.removeEventListener(this.constructor.prefix, this.reroute);
//   }
//
//   reroute(e) {
//     for (let at of this.constructor.list)
//       customEventFilters.callFilter(at, e);
//   }
//
//   get suffix() {
//     return "";
//   }
//
//   static nonBubblingEvent(prefix) {
//     return `on${prefix}` in window && !(`on${prefix}` in HTMLElement.prototype);
//   }
//
//   static subclass(prefix) {
//     if (!this.nonBubblingEvent(prefix))
//       return;
//     const Class = class NativeNonBubblingAttributeImpl extends NativeNonBubblingAttribute {
//     };
//     Class.prefix = prefix;
//     Class.list = [];
//     return Class;
//   }
// }

class EventRegistry {

  //todo if we have two ::, then the thing after the double colon is marked as a defaultAction. That makes sense
  //todo if we have a : infront of the attribute, then it is a once
  parse(text) {
    let res = {};
    if (text.indexOf(":") === -1)
      return;
    if (text.endsWith(":")) {
      text = text.substring(0, -1);
      res.endColon = true;
    }
    if (text.startsWith(":")) {
      text = text.substring(1);
      res.once = true;
    }
    let defaultAction, error;
    [text, defaultAction, error] = text.split("::");
    if (error) {
      //todo
      console.warn("cannot have two sets of '::' in a custom attribute.");
    }
    if (defaultAction)
      res.defaultAction = defaultAction;
    const [event, ...filter] = text.split(":");
    res.filterFunction = filter.join(":") || undefined;
    res.event = event;
    return res;
  }

  #unknownEvents = {};

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
    if (this[name])
      return this[name];
    const native = NativeBubblingAttribute.subclass(name) /*|| NativeNonBubblingAttribute.subclass(name)*/;
    if (native)
      return this[name] = native;
    for (let def in this)
      if (name.startsWith(def))
        return this[def];
  }

  upgrade(...attrs) {
    for (let at of attrs) {
      const res = customEvents.parse(at.name);
      if (!res)
        return;
      Object.assign(at, res);
      const Definition = this.find(at.event);
      Definition ?
        this.#upgradeAttribute(at, Definition) :
        (this.#unknownEvents[at.event] ??= []).push(at);        //todo dict pointing to a weak array
    }
  }

  #upgradeAttribute(at, Definition) {
    at.suffix = at.event.substring(Definition.prefix.length);
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

  prefixOverlaps(newPrefix) {
    for (let oldPrefix in this)
      if (newPrefix.startsWith(oldPrefix) || oldPrefix.startsWith(newPrefix))
        return oldPrefix;
  }

  #upgradeUnknownEvents(prefix, Definition) {
    for (let event in this.#unknownEvents)
      if (event.startsWith(prefix))
        for (let at of this.#unknownEvents[event])
          this.#upgradeAttribute(at, Definition);
  }
}

window.customEvents = new EventRegistry();