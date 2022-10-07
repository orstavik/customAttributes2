class ReactionRegistry {
  define(type, Function) {
    if (type in this)
      throw `The Reaction type: "${type}" is already defined.`;
    const str = Function.toString();
    const boundOrNot = str === "function () { [native code] }" || /^(async |)(\(|[^([]+=)/.test(str);
    this[type] = {Function, boundOrNot};
  }

  #cache = {};
  static #empty = Object.freeze([]);

  getReactions(reaction) {
    if (!reaction)
      return ReactionRegistry.#empty;
    if (this.#cache[reaction])
      return this.#cache[reaction];
    const res = [];
    for (let [prefix, ...suffix] of reaction.split(":").map(str => str.split("_"))) {
      if (!prefix)  //ignore empty
        continue;
      const Definition = this[prefix];
      if (!Definition)
        return [];
      const {Function, boundOrNot} = Definition;
      res.push({Function, prefix, suffix, boundOrNot});
    }
    return this.#cache[reaction] = res;
  }
}

window.customReactions = new ReactionRegistry();

//Some CustomAttr lookups are used frequently!
//1. the prefix is checked every time the attribute is passed by for an event in the DOM.
//2. the suffix is used only once per attribute.
//3. The filterFunction(), defaultAction() and allFunctions() are used every time they are called.
class CustomAttr extends Attr {
  get suffix() {
    return this.name.match(/_?([^:]+)/)[1].split("_").slice(1);
  }

  get filterFunction() {
    const value = this.name.split("::")[0].split(":").slice(1)?.join(":");
    Object.defineProperty(this, "filterFunction", {
      get: function () {
        return value;
      }
    });
    return value;
  }

  get defaultAction() {
    const value = this.name.split("::")[1];
    Object.defineProperty(this, "defaultAction", {
      get: function () {
        return value;
      }
    });
    return value;
  }

  get allFunctions() {
    const value = this.name.split(":").slice(1)?.join(":");
    Object.defineProperty(this, "allFunctions", {
      get: function () {
        return value;
      }
    });
    return value;
  }

  static eventAndType(attr) {
    const event = attr.name.match(/_?[^_:]+/)[0];
    const type = event[0] === "_" ? event.substring(1) : event;
    Object.defineProperty(attr, "event", {
      get: function () {
        return event;
      }
    });
    Object.defineProperty(attr, "type", {
      get: function () {
        return type;
      }
    });
    return {type, event};
  }
}

class NativeBubblingEvent extends CustomAttr {
  upgrade() {
    //todo this is not going to work for the global native event listeners. We need a different strategy for the global handlers actually.
    this._listener = this.listener.bind(this);
    this.ownerElement.addEventListener(this.type, this._listener);
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

class NativeDocumentOnlyEvent extends CustomAttr {
  upgrade() {
    const event = this.event;
    const attr = new WeakRef(this);
    const reroute = function (e) {
      const at = attr.deref();
      at && at.ownerElement ? //todo GC leak here. If the element is removed from the dom, but not yet GC, then this callback will still trigger.
        eventLoop.dispatch(e, at) :
        document.removeEventListener(event, reroute);
    }
    document.addEventListener(event, reroute);
  }
}

class NativeWindowOnlyEvent extends CustomAttr {
  upgrade() {
    const event = this.event;
    const attr = new WeakRef(this);
    const reroute = function (e) {
      const at = attr.deref();
      at && at.ownerElement ?                                       //todo we have a GC leak here.
        eventLoop.dispatch(e, at) :
        window.removeEventListener(event, reroute);
    }
    window.addEventListener(event, reroute);
  }
}

//todo
class PassiveNativeBubblingEvent extends NativeBubblingEvent {
  upgrade() {
    super.upgrade();
    this.ownerElement.addEventListener(this.event, this._passiveListener = () => 1);
  }

  destructor() {
    //todo the destructor is safe, no? There will not be any possibility of removing the attribute from the element without
    // the destructor being called? Yes, it is safe for this purpose, but the element can be removed from the DOM without the destructor being called.
    this.ownerElement.addEventListener(this.event, this._passiveListener);
    super.destructor();
  }
}

function getNativeEventDefinition(prefix) {
  // prefix === "passivewheel" ? PassiveNativeBubblingEvent :  //todo
  return `on${prefix}` in HTMLElement.prototype ? NativeBubblingEvent :
    `on${prefix}` in window ? NativeWindowOnlyEvent :
      `on${prefix}` in Document.prototype && NativeDocumentOnlyEvent;
}

class WeakArrayDict {
  push(key, value) {
    (this[key] ??= []).push(new WeakRef(value));
  }

  * values(key) {
    for (let ref of this[key] || []) {
      const v = ref.deref();
      if (v?.ownerElement) //if no .ownerElement, the attribute has been removed from DOM but not yet GC.
        yield v;
    }
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
      const {event, type} = CustomAttr.eventAndType(at);
      const Definition = this[type] ??= getNativeEventDefinition(type);
      if (Definition)                                           //1. upgrade to a defined CustomAttribute
        this.#upgradeAttribute(at, Definition);
      else {
        if (at.name.indexOf(":") > 0)                           //2. upgrade to the generic CustomAttribute, as it enables event listeners.
          Object.setPrototypeOf(at, CustomAttr.prototype);      //   this enables reactions to events with the given name.
        this.#unknownEvents.push(type, at);                     //3. register unknown attrs
      }
      if (event[0] === "_")
        this.#globals.push(type, at);                           //4. register globals
    }
  }

  globalListeners(type) {
    return this.#globals.values(type);
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
        EventLoop.callFilterImpl(target.allFunctions, target, event);
      this.#eventLoop.shift();
    }
  }

  static bubble(target, event) {
    for (let t = target; t; t = t.assignedSlot || t.parentElement || t.parentNode?.host) {
      for (let attr of t.attributes) {
        if (attr.event === event.type) {
          if (attr.defaultAction && (event.defaultAction || event.defaultPrevented))
            continue;
          const res = EventLoop.callFilterImpl(attr.filterFunction, attr, event);
          if (res !== undefined && attr.defaultAction)
            event.defaultAction = {attr, res};
        }
      }
    }
    const prevented = event.defaultPrevented;          //global listeners can't call .preventDefault()
    for (let attr of customAttributes.globalListeners(event.type))
      EventLoop.callFilterImpl(attr.allFunctions, attr, event);
    if (event.defaultAction && !prevented) {
      const {attr, res} = event.defaultAction;
      EventLoop.callFilterImpl(attr.defaultAction, attr, res);
    }
  }

  static callFilterImpl(filters, at, event) {
    for (let {Function, prefix, suffix, boundOrNot} of customReactions.getReactions(filters)) {
      try {
        event = boundOrNot ?
          Function(event, prefix, ...suffix) :
          Function.call(at, event, prefix, ...suffix);
      } catch (error) {
        eventLoop.dispatch(new ErrorEvent("FilterError", {error}), at.ownerElement);
        return;
      }
      if (event === undefined)
        return;
    }
    return event;
  }
}

window.eventLoop = new EventLoop();

function deprecate(name) {
  return function deprecated() {
    throw `${name}() is deprecated`;
  }
}

(function (Element_proto, documentCreateAttributeOG,) {
  const removeAttrOG = Element_proto.removeAttribute;
  const getAttrNodeOG = Element_proto.getAttributeNode;
  const setAttributeNodeOG = Element_proto.setAttributeNode;
  Element.prototype.hasAttributeNS = deprecate("Element.hasgetAttributeNS");
  Element.prototype.getAttributeNS = deprecate("Element.getAttributeNS");
  Element.prototype.setAttributeNS = deprecate("Element.setAttributeNS");
  Element.prototype.removeAttributeNS = deprecate("Element.removeAttributeNS");
  Element.prototype.getAttributeNode = deprecate("Element.getAttributeNode");
  Element.prototype.setAttributeNode = deprecate("Element.setAttributeNode");
  Element.prototype.removeAttributeNode = deprecate("Element.removeAttributeNode");
  Element.prototype.getAttributeNodeNS = deprecate("Element.getAttributeNodeNS");
  Element.prototype.setAttributeNodeNS = deprecate("Element.setAttributeNodeNS");
  Element.prototype.removeAttributeNodeNS = deprecate("Element.removeAttributeNodeNS");
  document.createAttribute = deprecate("document.createAttribute");

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