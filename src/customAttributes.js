class CustomAttr extends Attr {
  get type() {
    const value = this.name.match(/_?([^_:]+)/)[1];
    Object.defineProperty(this, "type", {value, writable: false, configurable: true});
    return value;
  }

  get suffix() {
    return this.name.match(/_?([^:]+)/)[1].split("_").slice(1);
  }

  get chain() {
    const value = this.name.split(":").slice(1);
    Object.defineProperty(this, "chain", {value, writable: false, configurable: true});
    return value;
  }

  get defaultAction() {
    const value = this.chain?.indexOf("") + 1 || 0;
    Object.defineProperty(this, "defaultAction", {value, writable: false, configurable: true});
    return value;
  }

  get reactions() {
    const value = this.chain.map(reaction => customReactions.getReaction(reaction));
    if (value.indexOf(undefined) >= 0)
      return undefined;
    Object.defineProperty(this, "reactions", {value, writable: false, configurable: true});
    return value;
  }

  get ready() {
    return this.reactions !== undefined;
  }

  errorString(i) {  //todo this.ownerElement can void when the error is printed..
    const chain = this.chain.slice(0);
    chain[i] = `==>${chain[i]}<==`;
    return `<${this.ownerElement?.tagName.toLowerCase()} ${this.name.split(":")[0]}:${chain.join(":")}>`;
  }
}

class Reaction {

  constructor(parts, Function) {
    this.Function = Function;
    this.parts = parts;
  }

  run(at, e) {
    return this.Function.call(at, e, ...this.parts);
  }

  get prefix() {
    return this.parts[0];
  }

  get suffix() {
    return this.parts.slice(1);
  }
}

class DotPath {

  constructor(part) {
    const getter = part.endsWith(".") ? 1 : 0;
    const spread = part.startsWith("...") ? 3 : 0;
    let path = part.substring(spread, part.length - getter);
    if (path[0] === ".")
      path = path.substring(1);
    this.getter = getter;
    this.spread = spread;
    this.dots = path.split(".").map(ReactionRegistry.toCamelCase);
    if (this.dots[0] !== "e" && this.dots[0] !== "this" && this.dots[0] !== "window")
      this.dots.unshift("window");
  }

  interpret(e, attr) {
    const res = [this.dots[0] === "e" ? e : this.dots[0] === "this" ? attr : window];
    for (let i = 1; i < this.dots.length; i++)
      res[i] = res[i - 1][this.dots[i]];
    return res;
  }

  interpretDotArgument(e, attr) {
    const objs = this.interpret(e, attr);
    const last = objs[objs.length - 1];
    const lastParent = objs[objs.length - 2];
    return this.getter || !(last instanceof Function) ? last : last.call(lastParent);
  }
}

class DotReaction extends Reaction {

  constructor(parts) {
    super(parts);
    this.dotParts = parts.map(DotReaction.parsePartDotMode);
    if (this.dotParts[0].spread)
      throw "spread on prefix does not make sense";
    if (this.dotParts[0].length > 1 && this.dotParts[0].getter)
      throw "this dot expression has arguments, then the prefix cannot be a getter (end with '.').";
  }

  run(at, e) {
    const dotParts = this.dotParts;
    const prefix = dotParts[0];
    const objs = prefix.interpret(e, at);
    const last = objs[objs.length - 1];
    if (prefix.getter || dotParts.length === 1 && !(last instanceof Function))
      return last;
    const args = [];
    for (let i = 1; i < dotParts.length; i++) {
      const dotPart = dotParts[i];
      const arg = dotPart?.dots ? dotPart.interpretDotArgument(e, at) : dotPart;
      dotPart.spread ? args.push(...arg) : args.push(arg);
    }
    const lastParent = objs[objs.length - 2]
    if (last instanceof Function)
      return last.call(lastParent, ...args);
    lastParent[prefix.dots[prefix.dots.length - 1]] = args.length === 1 ? args[0] : args;
    return e;
  }

  static parsePartDotMode(part) {
    const PRIMITIVES = {
      true: true,
      false: false,
      null: null,
      undefined: undefined
    };
    if (part in PRIMITIVES)
      return PRIMITIVES[part];
    if (!isNaN(part))
      return Number(part);
    if (part === "e" || part === "this" || part === "window" || part.indexOf(".") >= 0)
      return new DotPath(part);
    return part;
  }
}

class ReactionRegistry {

  #register = {};

  define(type, Function) {
    //todo add restriction that it cannot contain `.`
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

  #cache = {"": ""};

  getReaction(reaction) {
    return this.#cache[reaction] ??= this.#create(reaction);
  }

  #create(reaction) {
    const parts = reaction.split("_");
    return parts[0].indexOf(".") >= 0 ? new DotReaction(parts) :
      this.#register[parts[0]] && new Reaction(parts, this.#register[parts[0]]);
  }
}

window.customReactions = new ReactionRegistry();

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

  constructor(error, at, i, async) {
    super("error", {error, cancelable: true});
    this.pos = i;
    this.at = at;
    this.async = async;
  }

  get attribute() {
    return this.at;
  }

  get message() {
    return (this.async ? "ASYNC" : "") + this.at.errorString(this.pos);
  }
}

document.documentElement.setAttributeNode(document.createAttribute("error::console.error_e.message_e.error"));

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
          EventLoop.#runReactions(target.reactions, event, target, undefined);
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
            const res = EventLoop.#runReactions(attr.reactions, event, attr, !!attr.defaultAction);
            if (res !== undefined && attr.defaultAction)
              event.defaultAction = {attr, res, target};
          }
        }
      }
      const prevented = event.defaultPrevented;     //global listeners can't call .preventDefault()
      //eventToTarget.set(event, theTopMostTarget); //not necessary, bubble already set it
      for (let attr of customAttributes.globalListeners(event.type))
        EventLoop.#runReactions(attr.reactions, event, attr, false);
      if (event.defaultAction && !prevented) {
        const {attr, res, target} = event.defaultAction;
        eventToTarget.set(event, target);
        EventLoop.#runReactions(attr.reactions, res, attr, false, attr.defaultAction);
      }
    }

    static #runReactions(reactions = [], event, at, syncOnly = false, start = 0) {
      for (let i = start; i < reactions.length; i++) {
        const reaction = reactions[i];
        if (!reaction && syncOnly)
          return event;
        else if (!reaction)
          continue;
        try {
          event = reaction.run(at, event);
          if (event === undefined)
            return;
          if (event instanceof Promise) {
            if (syncOnly)
              throw new SyntaxError("You cannot use reactions that return Promises before default actions.");
            event
              .then(event => this.#runReactions(reactions, event, at, false, i + 1))
              //todo we can pass in the input to the reaction to the error event here too
              .catch(error => eventLoop.dispatch(new ReactionErrorEvent(error, at, i, true), at.ownerElement));
            return;
          }
        } catch (error) {    //todo we can pass in the input to the error event here.
          if (start !== 0) console.info("omg wtf")
          return eventLoop.dispatch(new ReactionErrorEvent(error, at, i, start !== 0), at.ownerElement);
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