class DotReaction {
  static PRIMITIVES = Object.freeze({
    true: true,
    false: false,
    null: null,
    undefined: undefined
  });

  static interpretDotPath(dots, e, thiz) {
    const res = [dots[0] === "e" ? e : dots[0] === "this" ? thiz : window];
    for (let i = 1; i < dots.length; i++)
      res[i] = res[i - 1][dots[i]];
    return res;
  }

  static interpretDotArgument(dotPart, e, thiz) {
    const objs = DotReaction.interpretDotPath(dotPart.dots, e, thiz);
    const last = objs[objs.length - 1];
    const lastParent = objs[objs.length - 2];
    return dotPart.getter || !(last instanceof Function) ? last : last.call(lastParent);
  }

  static parseDotPath(part) {
    const dots = part.split(".").map(ReactionRegistry.toCamelCase);
    if (dots[0] !== "e" && dots[0] !== "this" && dots[0] !== "window")
      dots.unshift("window");
    return dots;
  }

  static parsePartDotMode(part) {
    if (part in DotReaction.PRIMITIVES)
      return DotReaction.PRIMITIVES[part];
    if (!isNaN(part))
      return Number(part);
    if (part === "e" || part === "this" || part === "window")
      return {dots: [part]};
    if (part.indexOf(".") < 0)
      return part;
    const getter = part.endsWith(".") ? 1 : 0;
    const spread = part.startsWith("...") ? 3 : 0;
    let path = part.substring(spread, part.length - getter);
    if(path[0] === ".")
      path = path.substring(1);
    const dots = DotReaction.parseDotPath(path);
    return {getter, spread, dots};
  }

  static runDotReaction(e, _, ...dotParts) {
    const prefix = dotParts[0];
    const objs = DotReaction.interpretDotPath(prefix.dots, e, this);
    const last = objs[objs.length - 1];
    if (prefix.getter || dotParts.length === 1 && !(last instanceof Function))
      return last;
    const args = [];
    for (let i = 1; i < dotParts.length; i++) {
      const dotPart = dotParts[i];
      const arg = dotPart?.dots ? DotReaction.interpretDotArgument(dotPart, e, this) : dotPart;
      dotPart.spread ? args.push(...arg) : args.push(arg);
    }
    const lastParent = objs[objs.length - 2]
    if (last instanceof Function)
      return last.call(lastParent, ...args);
    lastParent[prefix.dots[prefix.dots.length - 1]] = args.length === 1 ? args[0] : args;
    return e;
  }

  static parseDotReaction(parts) {
    if (parts[0].indexOf(".") < 0)
      return;
    const dotParts = parts.map(DotReaction.parsePartDotMode);
    if (dotParts[0].spread)
      throw "spread on prefix does not make sense";
    if (dotParts[0].length > 1 && dotParts[0].getter)
      throw "this dot expression has arguments, then the prefix cannot be a getter (end with '.').";
    return {Function: DotReaction.runDotReaction, prefix: parts, suffix: dotParts};
  }
}

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

  static toCamelCase(strWithDash) {
    return strWithDash.replace(/-([a-z])/g, g => g[1].toUpperCase());
  }

  #cache = {"": Object.freeze([])};

  #getListenerReaction([prefix, ...suffix]) {
    if (this.#register[prefix])
      return {Function: this.#register[prefix], prefix, suffix};
  }

  getReactions(reactions) {
    if (this.#cache[reactions])
      return this.#cache[reactions];
    const res = [];
    for (let parts of reactions.split(":").map(r => r.split("_"))) {
      const dotReaction = DotReaction.parseDotReaction(parts) || this.#getListenerReaction(parts);
      if (!dotReaction)
        return undefined;
      res.push(dotReaction);
    }
    return this.#cache[reactions] = res;
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
    const value = this.name.split(":").slice(1)?.filter(r => r).join(":");
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
      return this.#runReactions(customReactions.getReactions(reactions) || [], event, at, syncOnly, 0);
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