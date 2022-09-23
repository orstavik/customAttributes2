function nativeRerouteListener(e) {
  // e.preventDefault(); // if dispatchEvent propagates sync, native defaultActions can still be used.
  e.stopImmediatePropagation();
  e.composedPath()[0].dispatchEvent(e);
}

function makeNativeEventAttribute(name) {
  const Class = class NativeEventAttribute extends Attr {
    upgrade() {
      this.ownerElement.addEventListener(name, nativeRerouteListener);
    }

    destructor() {
      for (let o of this.ownerElement.attributes)
        if (name === o.constructor.prefix && o !== this)
          return;
      this.ownerElement.removeEventListener(name, nativeRerouteListener);
    }

    get suffix() {
      return "";
    }
  };
  Class.prefix = name;
  return Class;
}

class EventRegistry {

  //todo if we have two ::, then the thing after the double colon is marked as a defaultAction. That makes sense
  //todo if we have a : infront of the attribute, then it is a once
  parse(text) {
    let res = {};
    if (text.indexOf(":") === -1)
      return res;
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
    if (("on" + res.event) in HTMLElement.prototype)
      res.isNativeEvent = true;
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
    if (("on" + name) in HTMLElement.prototype)
      return this[name] = makeNativeEventAttribute.call(this, name); //todo make this into a different register.
    for (let def in this)
      if (name.startsWith(def))
        return this[def];
  }

  upgrade(at) {
    const Definition = this.find(at.event);
    Definition ?
      this.#upgradeAttribute(at, Definition) :
      (this.#unknownEvents[at.event] ??= []).push(at);        //todo dict pointing to a weak array
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