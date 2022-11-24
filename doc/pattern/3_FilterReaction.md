# Pattern: FilterReaction

The FilterReaction is a pattern for selecting a subset of a type of events. The FilterReaction pattern works by whitelisting the events that we wish to react to.

## WhenToUse: FilterReaction?

Most commonly, we filter events based on properties of that event. Here are some examples:

1. We want to only react to `mousedown` when the left mouse button is pressed.
2. We only want to react to `Enter` `keypress`.
3. We only want to react to `mousemove` if the `target` is of a specific type.

But. FilterReactions can also be used to filter events based on the state of the `.ownerElement` or the DOM in general. For example, we might wish to only respond to `click` events when the attribute `active` is added to the `.ownerElement`. We could achieve this by adding and removing a customAttribute in coordination with the `active` attribute, but we could also accomplish this by having a FilterReaction checking for this attribute preceding the element.

Finally, FilterReactions can be used to filter events based on global state. A good example of this is FilterReactions that are only active when `#debugger` is added to the `window.location`, or FilterReactions that only run when `navigator.onLine` is `true` or `false`.

## Demo 1: MousedownLeft

In this demo we filter the reactions to `mousedown` with left mouse button.

```html

<script src="https://cdn.jsdelivr.net/gh/orstavik/customAttributes2/src/customAttributes.js"></script>
<script src="https://cdn.jsdelivr.net/gh/orstavik/ElementObserver@1.1.0/startObserver.js"></script>

<h1 mousedown:button_0:log>hello sunshine</h1>
<script>
  customReactions.define("button", function (e, _, button) {
    if (e.button == button)
      return e;
  });
  customReactions.define("log", function (e) {
    console.log("mousedown main button!");
    return e;
  });
</script>
```

> Note: The `button` argument is a `string`, not a number. Therefore, we use the `==` to test for equality.

## Demo 2: FilterThis

In this demo we implement a counter upto five. This illustrates how we can filter reactions based on a value in the DOM, ie. an attribute value on the `.ownerElement`.

```html
<script src="https://cdn.jsdelivr.net/combine/gh/orstavik/customAttributes2/src/customAttributes.js,gh/orstavik/ElementObserver@1.1.0/startObserver.js"></script>

<style>
  h1 {user-select: none;}
  h1[click\:lessthan_5\:count="5"] {background: red;}
</style>
<h1 click:lessthan_5:count="0">hello sunshine</h1>
<script>
  customReactions.define("lessthan", function (e, _, max) {
    if (this.value < max)
      return e;
  });
  customReactions.define("count", function (e) {
    this.value = +this.value + 1;
    return e;
  });
</script>
```

## Demo 3: OnlyOffline

In this demo we filter the reaction when the browser is offline.

```html

<script src="https://cdn.jsdelivr.net/gh/orstavik/customAttributes2/src/customAttributes.js"></script>
<script src="https://cdn.jsdelivr.net/gh/orstavik/ElementObserver@1.1.0/startObserver.js"></script>

<h1 click:offline:log>hello sunshine</h1>
<script>
  customReactions.define("offline", function (e) {
    if (!navigator.onLine)
      return e;
  });
  customReactions.define("log", function (e) {
    console.log(e.target.tagName + " was clicked while the browser is offline!");
    return e;
  });
</script>
```

## Implementation: The filter boilerplate

The filter functions follow the same boilerplate template all the time:

```javascript
function filterReaction(e) {
  if ( -> some whitelist condition <- )
    return e;
}
```

You can note the implicit `return undefined` at the end. Whenever a custom reaction returns `undefined` the next reaction will not run.

The filter functions always returns the input `e`.

You cannot really implement FilterReactions using dot-notation, even though we often would like to do so. The reason is that many dot reactions returns something other than `undefined` when false, and that the dot reactions does not return the input event `e` that you wish to pass on.  

## WhatTo: look out for?

The FilterReactions are usually put in the beginning of the reaction chain. If you place a FilterReaction *after* another reaction that performs a DOM mutation or other side-effect, then the FilterReaction will not prevent that prior reaction. Of course.