function deprecate(name) {
  return function deprecated() {
    throw `${name}() is deprecated`;
  }
}

(function (
  Element_proto,
  EventTarget_proto,
  Event_proto,
  documentCreateAttributeOG,
  getAttrOG = Element_proto.getAttribute,
  setAttrOG = Element_proto.setAttribute,
  removeAttrOG = Element_proto.removeAttribute,
  getAttrNodeOG = Element_proto.getAttributeNode,
  setAttributeNodeOG = Element_proto.setAttributeNode,
  stopImmediatePropagationOG = Event_proto.stopImmediatePropagation,
  preventDefault = Event_proto.preventDefault,
  composedPathOG = Event_proto.composedPath,
  removeEventListenerOG = EventTarget_proto.removeEventListener,
  addEventListenerOG = EventTarget_proto.addEventListener
) {
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

  function nativeRerouteListener(e) {
    // preventDefault.call(e); // if dispatchEvent propagates sync, native defaultActions can still be used.
    stopImmediatePropagationOG.call(e);
    composedPathOG.call(e)[0].dispatchEvent(e);
  }

  EventTarget_proto.addEventListener = function (type, cb, ...args) {     //once, passive => syntactic solution?
    const cbName = customEventFilters.defineAnonymous(cb);
    this.setAttribute(type + ":" + cbName);
  };
  EventTarget_proto.removeEventListener = function (type, cb, ...args) {
    const cbName = customEventFilters.defineAnonymous(cb);
    this.removeAttribute(type + ":" + cbName);
  };

  let eventLoop = [];
  EventTarget_proto.dispatchEvent = function dispatchEvent(event) {
    eventLoop.push({target: this, event});
    if (eventLoop.length > 1)
      return;
    while (eventLoop.length) {
      const {target, event} = eventLoop.shift();
      for (let t = target; t; t = t.assignedSlot || t.parentNode instanceof HTMLElement ? t.parentNode : t.parentNode?.host)
        for (let attr of t.attributes)
          if (attr.name.startsWith(event.type + ":"))       //todo if we use the :prefix:filter, then this will be skipped.
            customEventFilters.callFilter(attr, event);
      //todo call the filter functions from the customEventFilter!
      //1. if the custom attribute ends with a ":" then it is either a default action, or a sync action?
      //2. once? How to mark once event listeners? should we add them as ":" at the beginning?
      //3. passive? This should probably be a special first filter ":passive". This will add a special event listener with the passive argument set to true on the target node. This would also need to be cleaned up.
    }
  }

  function getNativeEventName(at) {
    const parts = at.name.split(":");
    const isNativeProperty = ("on" + parts[0]) in HTMLElement.prototype;
    return parts.length > 1 && isNativeProperty && parts[0];
  }

  //todo 1. we need to ensure that the native event names are not in conflict with the given definitions.
  //todo 2. maybe move this inside the customEvents.upgrade method too??
  function getEventName(at) {
    const parts = at.name.split(":");
    if (parts.length < 2)
      return;
    if (parts.length === 2 && parts[0] === "")
      return parts[1];
    return parts[0];
  }

  //todo syntax: ":timeout50:log:bob"  "click:log:bob"  "click:log:open:"
  //todo what do we need? once? filter as default defaultAction? last filter as defaultAction?

  //todo if we have two ::, then the thing after the double colon is marked as a defaultAction. That makes sense
  //todo if we have a : infront of the attribute, then it is a once
  //step 1, see if the

  function newAttribute(at) {
    let text = at.name;
    if (at.name.indexOf(":") === -1)
      return;
    if (text.endsWith(":")) {
      text = text.substring(0, -1);
      at.endColon = true;
    }
    if (text.startsWith(":")) {
      text = text.substring(1);
      at.once = true;
    }
    [text, defaultAction, error] = text.split("::");
    if (error)
      throw "cannot have two sets of '::' in a custom attribute.";
    if (defaultAction)
      at.defaultAction = defaultAction;
    const [event, ...filter] = text.split(":");
    at.filterFunction = filter.join(":") || undefined;
    at.isNativeEvent = ("on" + event) in HTMLElement.prototype;
    if (at.isNativeEvent) {
      at.prefix = event;                               //so, this could maybe be done as a special customAttribute class definition?
      addEventListenerOG.call(at.ownerElement, event, nativeRerouteListener);
    }
    customEvents.upgrade(at, event, at.isNativeEvent);
  }

  function removeAttribute(at) {
    if (at.isNativeEvent && ![...at.ownerElement.attributes].find(o => o !== at && o.isNativeEvent && at.prefix === o.prefix))
      removeEventListenerOG.call(at.ownerElement, at.prefix, nativeRerouteListener);
    at.destructor?.();
  }

  Element_proto.setAttribute = function (name, value) {
    if (this.hasAttribute(name)) {
      const at = getAttrNodeOG.call(this, name);
      const oldValue = at.value;
      at.value = value;
      at.changeCallback?.(oldValue);
    } else {
      const at = documentCreateAttributeOG.call(document, name);
      if (value !== undefined)
        at.value = value;
      setAttributeNodeOG.call(this, at);
      newAttribute(at);
      at.changeCallback?.(undefined);
    }
  };

  Element_proto.removeAttribute = function (name) {
    removeAttribute(getAttrNodeOG.call(this, name));
    removeAttrOG.call(this, name);
  };

  //todo we need to run the upgrade process for the customEvents (not needed for customEventFilters),
  // both after definition, and after "loading from template".
  //todo this means that we need to make a map of eventNames => weakArray of attributes.
  ElementObserver.end(el => {
    for (let at of el.attributes)
      newAttribute(at);
  });
})(Element.prototype, EventTarget.prototype, Event.prototype, document.createAttribute);