# Pattern: DispatchReaction

## WhatIs: DispatchReaction?

DispatchReaction is a pattern for dispatching events from reactions. The DispatchReaction must create a new `Event` and then dispatch that event to an element in the DOM, most often the `.ownerElement` of the reaction.

There is one important thing to remember when dispatching an event from a reaction: do not dispatch the same event nor the same event type as the trigger event! This will only cause an infinite loop.

## WhenToUse: DispatchReaction?

The DispatchReaction is commonly used when an event is **interpreted** to mean something. For example, when the "physical" `click` or `keypress` event is interpreted to mean a "conceptual" `submit` event.

## Demo 1: DetailsToggle

In this demo we replicate the same behavior as the native `<details><summary>` `toggle`. When the user `click` on the `<summary>` element, then it will produce a new `toggle` event. We then add an event reaction for the `toggle` event that flips the `open` attribute on the `<details>` element.

```html

<script src="https://cdn.jsdelivr.net/gh/orstavik/customAttributes2/src/customAttributes.js"></script>
<script src="https://cdn.jsdelivr.net/gh/orstavik/ElementObserver@1.1.0/startObserver.js"></script>

<style>
  :not([open]) > span:not(:first-child) {display: none;}
</style>

<div toggle:open>
  <span click:dispatch_toggle>hello</span>
  <span>sunshine</span>
</div>

<script>
  customReactions.define("open", function (e, name) {
    const el = this.ownerElement;
    el.hasAttribute(name) ? el.removeAttribute(name) : el.setAttribute(name, "");
    return e;
  });
  customReactions.define("dispatch", function (e, _, name) {
    this.ownerElement.dispatchEvent(new Event(name, {bubbles: true}));
    return e;
  });
</script>
```

There are a couple of things to note on this re-mediation of the native `toggle` sequence:

1. The `toggle` event in this example is a "before-toggle" event, while the native `toggle` event is an "after-toggle" event.
2. This means that if we call `.preventDefault()` on the native toggle event, it will not prevent the change. This means that in order to prevent the reaction from the native `<details>` element, you need to call `.preventDefault()` on the `click` event. We will look more into this in the chapter on DefaultActionReaction.
3. Furthermore, the native `<summary>` element does neither react to the `click` event, nor is the `<summary>` the target for the `toggle` event. In native HTML, the `<details>` does everything. The native behavior is parent sentric, while the custom reactions implemented in this example is child sentric.

When you make your own DispatchReactions you should both use "before-change" and "child sentric" behavior. The architecture of the native elements and `toggle` event is... not optimal. The reason is that you want to control the UIX from the element that the user interacts with. You want to stay as close to the target as possible. This reflects the developers common understanding that the `click` on the `<summary>` is the thing that triggers the `toggle` event. And it makes it easier to distinguish between preventing `click` in general and just preventing the `toggle`.

## Demo 2: DetailsDetails (todo make a better example, maybe put in a later chapter?)

In this example we will add `.details` to our custom event. To do that we will use two reactions, one to generate the `details` object and the second to dispatch the details object.

The example we use is an element that will show the `tagName` of a child being `click`ed, and the `x` and `y` coordinates of that `click`.

```html
<script src="https://cdn.jsdelivr.net/gh/orstavik/customAttributes2/src/customAttributes.js"></script>
<script src="https://cdn.jsdelivr.net/gh/orstavik/ElementObserver@1.1.0/startObserver.js"></script>

<div info:show-info>
  <h3></h3>
  <div click:get-info:dispatch_info>
    <h1>hello</h1>
    <h2>sunshine</h2>
  </div>
</div>

<script>
  customReactions.define("get-info", function (e) {
    return {tag: e.target.tagName, x: e.x, y: e.y};
  });
  customReactions.define("show-info", function (e) {
    this.ownerElement.children[0].textContent = JSON.stringify(e.details);
    return e;
  });
  customReactions.define("dispatch", function (details, _, name) {
    const customEvent = new CustomEvent(name, {bubbles: true, details});
    this.ownerElement.dispatchEvent(customEvent);
    return customEvent;
  });
</script>
```

In the later chapters HarvestReaction we will describe the `get-info` reaction in more detail; in the UpdateDOMReaction chapter we will look at the `show-info` reaction in more detail.

In a real app using customAttributes, the `get-info` and `show-info` reactions will likely be custom-made to that application. The dispatch with details will however most likely be a generic, reusable reaction.

## Implementation: OneDispatchToRuleThemAll

```javascript
function dispatch (e, _, name) {
  let event;
  if(e instanceof Event)
    event = new e.constructor(name, e);
  else if(e instanceof Object)
    event = new CustomEvent(name, {details: e, bubbles: true});
  else
    event = new Event(name);
  this.ownerElement.dispatchEvent(event);
  return event;
}
```

## WhatTo: return?

The DispatchReaction should return the newly created event that is dispatched. This is more or less a universal rule. The reason for this is that if you need to do other operations on the trigger event, you most likely can do those actions before the dispatch, or you can do them on a separate event listener on the same element. 

## WhatTo: look out for?

Sometimes you might have two events being dispatched in "one" reaction, such as the `mouseleave` and `mouseenter` events might be triggered by a single `mousemove` event.

However, most often, your DispatchReaction should end a reaction chain and be the last reaction in a chain. If you have some actions after this reaction, those are most commonly only debugging reactions.   
