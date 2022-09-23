class EventRegistry {
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
    this.upgradeUnknownEvents(prefix, Class);
  }

  getName(Class) {
    for (let name in this)
      if (this[name] === Class)
        return name;
  }

  find(name) {
    for (let def in this)
      if (name.startsWith(def))
        return {Definition: this[def], suffix: name.substring(def.length)};
  }

  upgrade(at, name, native) {
    if (native) {
      at.suffix = "";
      at.filterFunction = at.name.substring(name.length + 1);
    } else {
      const def = this.find(name) || {}; //todo simplify
      if (!def.Definition)
        return this.addUnknownEvents(name, at); //todo dict pointing to a weak array
      this.#upgradeAttribute(at, def.suffix, def.Definition, name);
    }
  }

  #upgradeAttribute(at, suffix, Definition, name) {
    at.suffix = name.substring(Definition.prefix.length);
    at.filterFunction = at.name.substring(name.length + 1);
    try {
      Object.setPrototypeOf(at, Definition.prototype);
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

  addUnknownEvents(event, at) {
    (this.#unknownEvents[event] ??= []).push(at);
  }

  upgradeUnknownEvents(prefix, Definition) {
    for (let event in this.#unknownEvents) {
      if (event.startsWith(prefix)) {
        for (let at of this.#unknownEvents[event]) {
          const name = at.name.split(":")[0];    //todo this is naive, we need to check for ":"
          this.#upgradeAttribute(at, name.substring(Definition.prefix.length), Definition, name);
        }
      }
    }
  }
}

window.customEvents = new EventRegistry();