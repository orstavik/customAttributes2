class ReactionRegistry {

  #register = {};

  define(type, Function) {
    if (type in this.#register)
      throw `The Reaction type: "${type}" is already defined.`;
    this.#register[type] = Function;
  }

  defineAll(defs) {
    for (let [type, Function] of Object.entries(defs))
      this.define(type, Function);
  }

  static #doDots(dots, thiz, e) {
    dots = dots.split(".");
    let obj = dots[0] === "e" ? e : dots[0] === "this" ? thiz : window;
    let parent;
    for (let i = (obj === window ? 0 : 1); i < dots.length; i++)
      parent = obj, obj = obj[this.toCamelCase(dots[i])];
    return {obj, parent};
  }

  static toCamelCase(strWithDash) {
    return strWithDash.replace(/-([a-z])/g, g => g[1].toUpperCase());
  }

  static call(e, prefix, ...args) {
    let explicitProp = false;
    if (prefix.endsWith("."))
      explicitProp = true, prefix = prefix.substring(0, prefix.length - 1);
    const {obj, parent} = ReactionRegistry.#doDots(prefix, this, e);
    return !(obj instanceof Function) || explicitProp ? obj : obj.call(parent, ...args, e);
  }

  static apply(e, prefix, ...args) {
    const {obj, parent} = ReactionRegistry.#doDots(prefix.substring(3), this, e);
    return obj.call(parent, ...args, ...e);
  }

  #cache = {"": Object.freeze([])};

  getReactions(reaction) {
    if (this.#cache[reaction])
      return this.#cache[reaction];
    const res = [];
    for (let [prefix, ...suffix] of reaction.split(":").map(str => str.split("_"))) {
      if (!prefix) continue;        //ignore empty strings enables "one::two" to run as one sequence
      if (prefix.startsWith("..."))
        this.#register[prefix] = ReactionRegistry.apply;
      else if (prefix.indexOf(".") >= 0)
        this.#register[prefix] = ReactionRegistry.call;
      else if (!this.#register[prefix]) return []; //one undefined reaction disables the entire chain reaction
      res.push({Function: this.#register[prefix], prefix, suffix});
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

  //todo if elements with global a customAttr is removed in JS but not yet GCed, this will still run
  empty(key) {
    for (let _ of this.values(key))
      return false;
    return true;
  }
}

class AttributeRegistry {

  #unknownEvents = new WeakArrayDict();
  #globals = new WeakArrayDict();

  define(prefix, Definition) {
    if (!(Definition.prototype instanceof CustomAttr))
      throw `"${Definition.name}" must extend "CustomAttr".`;
    if (this.getDefinition(prefix))
      throw `The customAttribute "${prefix}" is already defined.`;
    this[prefix] = Definition;
    for (let at of this.#unknownEvents.values(prefix))
      this.#upgradeAttribute(at, Definition);
    delete this.#unknownEvents[prefix];
  }

  upgrade(...attrs) {
    for (let at of attrs) {
      const type = at.name.match(/_?([^_:]+)/)[1];
      const Definition = this.getDefinition(type);
      if (Definition)                                    //1. upgrade to a defined CustomAttribute
        this.#upgradeAttribute(at, Definition);
      else if (at.name.indexOf(":") > 0)                 //2. upgrade unknown/generic customAttribute
        Object.setPrototypeOf(at, CustomAttr.prototype);
      if (!Definition)                                   //3. register unknown attrs
        this.#unknownEvents.push(type, at);
      at.name[0] === "_" && this.#globals.push(at.type, at);//* register globals
    }
  }

  getDefinition(type) {
    return this[type];
  }

  globalListeners(type) {
    return this.#globals.values(type);
  }

  globalEmpty(type) {
    return this.#globals.empty(type);
  }

  #upgradeAttribute(at, Definition) {
    Object.setPrototypeOf(at, Definition.prototype);
    try {
      at.upgrade?.();
    } catch (error) {
      Object.setPrototypeOf(at, CustomAttr.prototype);
      //todo fix the error type here.
      eventLoop.dispatch(new ErrorEvent("error", {error}), at.ownerElement);
    }
    try {
      at.changeCallback?.();
    } catch (error) {
      //todo fix the error type here.
      eventLoop.dispatch(new ErrorEvent("error", {error}), at.ownerElement);
    }
  }
}

window.customAttributes = new AttributeRegistry();

class ReactionErrorEvent extends ErrorEvent {
  #reactions;
  #i;
  #at;

  constructor(error, at, reactions, i, async) {
    super("error", {error});
    this.#reactions = reactions;
    this.#i = i;
    this.#at = at;
    this.async = async;
  }

  get attribute() {
    return this.#at;
  }

  get reaction() {
    return this.#reactions[this.#i].prefix + this.#reactions[this.#i].suffix.map(s => "_" + s);
  }
}

(function () {

//Event.uid
  let eventUid = 1;
  const eventToUid = new WeakMap();
  Object.defineProperty(Event.prototype, "uid", {
    get: function () {
      let uid = eventToUid.get(this);
      uid === undefined && eventToUid.set(this, eventUid++);
      return eventUid;
    }
  });

  const eventToTarget = new WeakMap();
  Object.defineProperty(Event.prototype, "target", {
    get: function () {
      return eventToTarget.get(this);
    }
  });
  const _event_to_Document_to_Target = new WeakMap();

  function getTargetForEvent(event, target, root = target.getRootNode()) {
    const map = _event_to_Document_to_Target.get(event);
    if (!map) {
      _event_to_Document_to_Target.set(event, new Map([[root, target]]));
      return target;
    }
    let prevTarget = map.get(root);
    !prevTarget && map.set(root, prevTarget = target);
    return prevTarget;
  }

  //todo path is not supported

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
        //todo if (target?.isConnected === false) then bubble without default action?? I think that we need the global listeners to run for disconnected targets, as this will make them able to trigger _error for example. I also think that attributes on disconnected ownerElements should still catch the _global events. Don't see why not.
        else if (target instanceof Attr)
          EventLoop.#callReactions(target.allFunctions, target, event);
        this.#eventLoop.shift();
      }
    }

    static bubble(rootTarget, event, target = rootTarget) {
      for (let prev, t = rootTarget; t; prev = t, t = t.assignedSlot || t.parentElement || t.parentNode?.host) {
        t !== prev?.parentElement && eventToTarget.set(event, target = getTargetForEvent(event, t));
        for (let attr of t.attributes) {
          if (attr.type === event.type && attr.name[0] !== "_") {
            if (attr.defaultAction && (event.defaultAction || event.defaultPrevented))
              continue;
            const res = EventLoop.#callReactions(attr.reaction, attr, event, !!attr.defaultAction);
            if (res !== undefined && attr.defaultAction)
              event.defaultAction = {attr, res, target};
          }
        }
      }
      const prevented = event.defaultPrevented;     //global listeners can't call .preventDefault()
      //eventToTarget.set(event, theTopMostTarget); //not necessary, bubble already set it
      for (let attr of customAttributes.globalListeners(event.type))
        EventLoop.#callReactions(attr.allFunctions, attr, event);
      if (event.defaultAction && !prevented) {
        const {attr, res, target} = event.defaultAction;
        eventToTarget.set(event, target);
        EventLoop.#callReactions(attr.defaultAction, attr, res);
      }
    }

    static #callReactions(reactions, at, event, syncOnly = false) {
      return this.#runReactions(customReactions.getReactions(reactions), event, at, syncOnly, 0);
    }

    static #runReactions(reactions, event, at, syncOnly, start) {
      for (let i = start; i < reactions.length; i++) {
        let {Function, prefix, suffix} = reactions[i];
        try {
          event = Function.call(at, event, prefix, ...suffix);
          if (event === undefined)
            return;
          if (event instanceof Promise) {
            if (syncOnly)
              throw new SyntaxError("You cannot use reactions that return Promises before default actions.");
            event
              .then(event => this.#runReactions(reactions, event, at, syncOnly, i + 1))
              .catch(error => eventLoop.dispatch(new ReactionErrorEvent(error, at, reactions, i, true), at.ownerElement));
            return;
          }
        } catch (error) {
          return eventLoop.dispatch(new ReactionErrorEvent(error, at, reactions, i, start === 0), at.ownerElement);
        }
      }
      return event;
    }
  }

  window.eventLoop = new EventLoop();
})();

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
      at.changeCallback?.(oldValue);      //todo try catch and tests for try catch, see the upgrade process above
    } else {
      const at = documentCreateAttributeOG.call(document, name);
      if (value !== undefined)
        at.value = value;
      setAttributeNodeOG.call(this, at);
      customAttributes.upgrade(at);       //todo try catch and tests for try catch, see the upgrade process above
    }
  };

  Element_proto.removeAttribute = function (name) {
    getAttrNodeOG.call(this, name)?.destructor?.();
    removeAttrOG.call(this, name);
  };
})(Element.prototype, document.createAttribute);

document.addEventListener("element-created", ({detail: els}) => els.forEach(el => customAttributes.upgrade(...el.attributes)));
// ElementObserver.end(el => customAttributes.upgrade(...el.attributes));

//** CustomAttribute registry with builtin support for the native HTML events.
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

class NativeEventDocument extends CustomAttr {
  reroute(e) {
    //todo cleanup for troublesome GC of eventlisteners associated with removed elements.
    if (customAttributes.globalEmpty(this.type))
      this._listenerTarget.removeEventListener(this.type, this._reroute);
    else
      eventLoop.dispatch(e);
  }

  upgrade() {
    if (this.name[0] !== "_")
      throw new SyntaxError(`AttributeError: missing "_" for global-only event: "_${this.name}".`);
    this._listenerTarget.addEventListener(this.type, this._reroute = this.reroute.bind(this));
  }

  destructor() {
    this._listenerTarget.removeEventListener(this.type, this._reroute);
  }

  get _listenerTarget() {
    return document;
  }
}

class NativeEventWindow extends NativeEventDocument {
  get _listenerTarget() {
    return window;
  }
}

class NativeEventDCL extends NativeEventDocument {
  get type() {
    return "DOMContentLoaded";
  }
}

class NativeEventsAttributeRegistry extends AttributeRegistry {
  #nativeCustomAttrs = {
    "domcontentloaded": NativeEventDCL,
    "fastwheel": NativePassiveEvent,
    "fastmousewheel": NativePassiveEvent,
    "fasttouchstart": NativePassiveEvent,
    "fasttouchmove": NativePassiveEvent,
    "touchstart": NativeBubblingEvent,
    "touchmove": NativeBubblingEvent,
    "touchend": NativeBubblingEvent,
    "touchcancel": NativeBubblingEvent
  };

  getDefinition(type) {
    return super.getDefinition(type) ||
      (this.#nativeCustomAttrs[type] ??=
        `on${type}` in HTMLElement.prototype ? NativeBubblingEvent :
          `on${type}` in window ? NativeEventWindow :
            `on${type}` in Document.prototype && NativeEventDocument);
  }
}

window.customAttributes = new NativeEventsAttributeRegistry();