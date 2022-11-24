# Pattern: ThrottleReaction

The ThrottleReaction is a pattern for filtering events based on the history of previous events. As the FilterReactions, ThrottleReactions also whitelist events and returns the input event/`e`.

## WhenToUse: ThrottleReaction?

todo

## Demo 1: JsonThrottle

In this demo we filter the reactions to `mousedown` with left mouse button.

```html
<script src="https://cdn.jsdelivr.net/combine/gh/orstavik/customAttributes2/src/customAttributes.js,gh/orstavik/ElementObserver@1.1.0/startObserver.js"></script>

<style>h1 {user-select: none}</style>

<h1 mousedown:throttle:cameleon>hello sunshine</h1>
<script>
  let previousButton;
  customReactions.define("throttle", function (e) {
    if (e.button === previousButton)
      return;
    previousButton = e.button;
    return e;
  });
  customReactions.define("cameleon", function (e) {
    const colors = ["red", "orange", "yellow", "green", "blue"];
    this.ownerElement.style.background = colors[Math.floor(colors.length * Math.random())];
    return e;
  });
</script>
```

But. There is one particular thing to note here. The `previousButton` stores data outside of the DOM in a closure variable. This we would like to avoid where possible. Since this is a small value, we instead store this value in the custom attribute value:

```html
<script src="https://cdn.jsdelivr.net/combine/gh/orstavik/customAttributes2/src/customAttributes.js,gh/orstavik/ElementObserver@1.1.0/startObserver.js"></script>

<style>h1 {user-select: none}</style>

<h1 mousedown:throttle:cameleon>hello sunshine</h1>
<script>
  customReactions.define("throttle", function (e) {
    if (e.button === this.value)
      return;
    this.value = e.button;
    return e;
  });
  customReactions.define("cameleon", function (e) {
    const colors = ["red", "orange", "yellow", "green", "blue"];
    this.ownerElement.style.background = colors[Math.floor(colors.length * Math.random())];
    return e;
  });
</script>
```

> Note. If the value needed to be stored is huge and you don't want to mess up the "tag space" of your ownerElement, you can store this state in for example a `<meta>` element under the `<head>`. However, preserving complex historical data in your app is a complex topic that needs to be discussed on its own.

## WhatTo: look out for?

ThrottleReactions are complex:
1. What method of serialization is used? In the example above we use JSON, and often, lots of data is either not serialized using JSON (ref. `Event`), or this simple method may be included that you didn't anticipate). You need to know the details of the serialization method that you use when throttling. 
   1. What data is serialized in your use case?
   2. How is that data compared with the next data input? 
   3. Is the method of serialization and comparison too costly for your use case?
2. Where do you store the state? And might there be problems if your app is taken down and up without this data being accessible?
