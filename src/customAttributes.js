class ReactionRegistry {
  define(type, Function) {
    if (type in this)
      throw `The Reaction type: "${type}" is already defined.`;
    this[type] = Function;
  }

  #cache = {"": Object.freeze([])};

  getReactions(reaction) {
    if (this.#cache[reaction])
      return this.#cache[reaction];
    const res = [];
    for (let [prefix, ...suffix] of reaction.split(":").map(str => str.split("_"))) {
      if (!prefix) continue;        //ignore empty strings thus enabling "one::two" to run as one sequence
      if (!this[prefix]) return []; //one undefined reaction disables the entire chain reaction
      res.push({Function: this[prefix], prefix, suffix});
    }
    return this.#cache[reaction] = res;
  }
}

window.customReactions = new ReactionRegistry();

class CustomAttr extends Attr {
  get suffix() {
    return this.name.match(/_?([^:]+)/)[1].split("_").slice(1);
  }

  get reaction() {
    const value = this.name.split("::")[0].split(":").slice(1)?.join(":");
    Object.defineProperty(this, "reaction", {value, writable: false, configurable: true});
    return value;
  }

  get defaultAction() {
    const value = this.name.split("::")[1];
    Object.defineProperty(this, "defaultAction", {value, writable: false, configurable: true});
    return value;
  }

  get allFunctions() {
    const value = this.name.split(":").slice(1)?.join(":");
    Object.defineProperty(this, "allFunctions", {value, writable: false, configurable: true});
    return value;
  }

  get type() {
    const value = this.name.match(/_?([^_:]+)/)[1];
    Object.defineProperty(this, "type", {value, writable: false, configurable: true});
    return value;
  }
}

class NativeBubblingEvent extends CustomAttr {
  upgrade() {
    this.ownerElement.addEventListener(this.type, this._listener = this.listener.bind(this));
  }

  listener(e) {
    // e.preventDefault(); // if dispatchEvent propagates sync, native defaultActions can still be used.
    e.stopImmediatePropagation();
    eventLoop.dispatch(e, e.composedPath()[0]);
  }

  destructor() {
    this.ownerElement.removeEventListener(this.type, this._listener);
  }
}

class NativePassiveEvent extends NativeBubblingEvent {
  upgrade() {
    Object.defineProperty(this, "type", {value: this.type.substring(4), writable: false, configurable: true});
    this.ownerElement.addEventListener(this.type, this._listener = this.listener.bind(this), {passive: true});
  }
}

class NativeDCLEvent extends CustomAttr {
  static reroute(e) {
    Object.defineProperty(e, "type", {value: "domcontentloaded"});
    eventLoop.dispatch(e);
    if (customAttributes.empty("domcontentloaded"))
      document.removeEventListener("DOMContentLoaded", this.reroute);
  }

  upgrade() {
    document.addEventListener("DOMContentLoaded", this.constructor.reroute);
  }
}

function getNativeGlobalAttrs(prefix, target = window) {
  return class NativeGlobalEvent extends CustomAttr {
    static reroute(e) {
      eventLoop.dispatch(e);
      if (customAttributes.empty(prefix))
        target.removeEventListener(prefix, this.reroute);
    }

    upgrade() {
      target.addEventListener(prefix, this.constructor.reroute);
    }
  }
}

const nativeCustomAttrs = {
  "domcontentloaded": NativeDCLEvent,
  "fastwheel": NativePassiveEvent,
  "fastmousewheel": NativePassiveEvent,
  "fasttouchstart": NativePassiveEvent,
  "fasttouchmove": NativePassiveEvent,
  "touchstart": NativeBubblingEvent,
  "touchmove": NativeBubblingEvent,
  "touchend": NativeBubblingEvent,
  "touchcancel": NativeBubblingEvent
};

function getNativeEventDefinition(prefix) {
  return nativeCustomAttrs[prefix] ??=
    `on${prefix}` in HTMLElement.prototype ? NativeBubblingEvent :
      `on${prefix}` in window ? getNativeGlobalAttrs(prefix) :
        `on${prefix}` in Document.prototype && getNativeGlobalAttrs(prefix, document);
}

class WeakArrayDict {
  push(key, value) {
    (this[key] ??= []).push(new WeakRef(value));
  }

  * values(key) {
    let filtered = [];
    for (let ref of this[key] || []) {
      const v = ref.deref();
      if (v?.ownerElement) {//if no .ownerElement, the attribute has been removed from DOM but not yet GC.
        filtered.push(ref);
        yield v;
      }
    }
    this[key] = filtered;
  }
}

class AttributeRegistry {

  #unknownEvents = new WeakArrayDict();
  #globals = new WeakArrayDict();

  define(prefix, Definition) {
    if (this[prefix])
      throw `The customEvent "${prefix}" is already defined.`;
    this[prefix] = Definition;
    for (let at of this.#unknownEvents.values(prefix))
      this.#upgradeAttribute(at, Definition);
    delete this.#unknownEvents[prefix];
  }

  upgrade(...attrs) {
    for (let at of attrs) {
      const type = at.name.match(/_?([^_:]+)/)[1];
      const Definition = this[type] ??= getNativeEventDefinition(type);
      if (Definition)                                    //1. upgrade to a defined CustomAttribute
        this.#upgradeAttribute(at, Definition);
      else if (at.name.indexOf(":") > 0)                 //2. upgrade unknown/generic customAttribute
        Object.setPrototypeOf(at, CustomAttr.prototype);
      if (!Definition)                                   //3. register unknown attrs
        this.#unknownEvents.push(type, at);
      at.name[0] === "_" && this.#globals.push(at.type, at);//* register globals
    }
  }

  globalListeners(type) {
    return this.#globals.values(type);
  }

  empty(type) {//todo if elements with global a customAttr is removed in JS but not yet GCed, this will still run
    return !this.#globals[type]?.length;
  }

  #upgradeAttribute(at, Definition) {
    Object.setPrototypeOf(at, Definition.prototype);
    try {
      at.upgrade?.();
    } catch (error) {
      Object.setPrototypeOf(at, CustomAttr.prototype);
      eventLoop.dispatch(new ErrorEvent("EventError", {error}), at.ownerElement);
    }
    try {
      at.changeCallback?.();
    } catch (error) {
      eventLoop.dispatch(new ErrorEvent("EventError", {error}), at.ownerElement);
    }
  }
}

window.customAttributes = new AttributeRegistry();

class EventLoop {
  #eventLoop = [];

  dispatch(event, target) {
    if (event.type[0] === "_")
      throw new Error(`eventLoop.dispatch(..) doesn't accept events beginning with "_": ${event.type}.`);
    this.#eventLoop.push({target, event});
    if (this.#eventLoop.length > 1)
      return;
    while (this.#eventLoop.length) {
      const {target, event} = this.#eventLoop[0];
      if (!target || target instanceof Element)   //a bug in the ElementObserver.js causes "instanceof HTMLElement" to fail.
        EventLoop.bubble(target, event);
      else if (target instanceof Attr)
        EventLoop.#callReactions(target.allFunctions, target, event);
      this.#eventLoop.shift();
    }
  }

  static bubble(target, event) {
    for (let t = target; t; t = t.assignedSlot || t.parentElement || t.parentNode?.host) {
      for (let attr of t.attributes) {
        if (attr.type === event.type && attr.name[0] !== "_") {
          if (attr.defaultAction && (event.defaultAction || event.defaultPrevented))
            continue;
          const res = EventLoop.#callReactions(attr.reaction, attr, event);
          if (res !== undefined && attr.defaultAction)
            event.defaultAction = {attr, res};
        }
      }
    }
    const prevented = event.defaultPrevented;  //global listeners can't call .preventDefault()
    for (let attr of customAttributes.globalListeners(event.type))
      EventLoop.#callReactions(attr.allFunctions, attr, event);
    if (event.defaultAction && !prevented) {
      const {attr, res} = event.defaultAction;
      EventLoop.#callReactions(attr.defaultAction, attr, res);
    }
  }

  static #callReactions(reactions, at, event) {
    for (let {Function, prefix, suffix} of customReactions.getReactions(reactions)) {
      try {
        event = Function.call(at, event, prefix, ...suffix);
      } catch (error) {
        return eventLoop.dispatch(new ErrorEvent("FilterError", {error}), at.ownerElement);
      }
      if (event === undefined)
        return;
    }
    return event;
  }
}

window.eventLoop = new EventLoop();

function deprecated() {
  throw `${this}() is deprecated`;
}

(function (Element_proto, documentCreateAttributeOG,) {
  const removeAttrOG = Element_proto.removeAttribute;
  const getAttrNodeOG = Element_proto.getAttributeNode;
  const setAttributeNodeOG = Element_proto.setAttributeNode;
  Element.prototype.hasAttributeNS = deprecated.bind("Element.hasgetAttributeNS");
  Element.prototype.getAttributeNS = deprecated.bind("Element.getAttributeNS");
  Element.prototype.setAttributeNS = deprecated.bind("Element.setAttributeNS");
  Element.prototype.removeAttributeNS = deprecated.bind("Element.removeAttributeNS");
  Element.prototype.getAttributeNode = deprecated.bind("Element.getAttributeNode");
  Element.prototype.setAttributeNode = deprecated.bind("Element.setAttributeNode");
  Element.prototype.removeAttributeNode = deprecated.bind("Element.removeAttributeNode");
  Element.prototype.getAttributeNodeNS = deprecated.bind("Element.getAttributeNodeNS");
  Element.prototype.setAttributeNodeNS = deprecated.bind("Element.setAttributeNodeNS");
  Element.prototype.removeAttributeNodeNS = deprecated.bind("Element.removeAttributeNodeNS");
  document.createAttribute = deprecated.bind("document.createAttribute");

  Element_proto.setAttribute = function (name, value) {
    if (this.hasAttribute(name)) {
      const at = getAttrNodeOG.call(this, name);
      const oldValue = at.value;
      if (oldValue === value)
        return;
      at.value = value;
      at.changeCallback?.(oldValue);
    } else {
      const at = documentCreateAttributeOG.call(document, name);
      if (value !== undefined)
        at.value = value;
      setAttributeNodeOG.call(this, at);
      customAttributes.upgrade(at);
    }
  };

  Element_proto.removeAttribute = function (name) {
    getAttrNodeOG.call(this, name).destructor?.();
    removeAttrOG.call(this, name);
  };
})(Element.prototype, document.createAttribute);

ElementObserver.end(el => customAttributes.upgrade(...el.attributes));