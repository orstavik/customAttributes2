# Pattern: ToggleReaction

## WhatIs: ToggleReaction?

ToggleReaction is a pattern for changing a single state property in the DOM. The ToggleReaction will change either the presence of or the value of either:

1. a single **attribute** (common/good),
2. a single **CSS class** (common/good), or
3. the `.textContent` of element(s) (uncommon/is this a good idea?).

The ToggleReaction most often target the `.ownerElement` of the attribute/reaction. However, the ToggleReaction pattern can just as easily be applied to change the value of other elements such as the parent element or host element of the attribute/reaction, ie. `.ownerElement.parent` or `.ownerElement.host || document.documentElement`.

The ToggleReaction can also target a specific attribute or css class on **a group of other elements** such as **all children** or **all siblings** of the `ownerElement`. When applied to a group of elements in this way, the ToggleReaction will change a several attributes/css classes, however it will still be one type of attribute on a clearly deliminated set of elements. When you employ the ToggleReaction in this way, the algorithm for deliminating the elements should be as simple and clear as possible. Avoid complex querySelectors, try to filter only on element `.tagName` if you can; and use children over descendants if you can.

## WhenToUse: ToggleReaction?

The ToggleReaction is commonly used in UIX control and interaction. For example, if you wish to change the appearance or behavior of an element when a user clicks it, this reaction is what you want.

But. The ToggleReaction pattern is also useful for system control. For example, you might wish to flip a switch when contact with a server has been achieved.

## Demo 1: StraightForwardBlue

In this demo we will change the appearance of an element every time the user clicks on that element. We do this by adding and removing the attribute `blue`.

```html

<script src="../../src/customAttributes.js"></script>
<script src="https://cdn.jsdelivr.net/gh/orstavik/ElementObserver@1.1.0/startObserver.js"></script>

<style>
  h1[blue] {background: blue}
</style>

<h1 click:toggle_blue>hello sunshine</h1>

<script>
  customReactions.define("toggle", function (e, _, name) {
    const el = this.ownerElement;
    el.hasAttribute(name) ? el.removeAttribute(name) : el.setAttribute(name, "");
    return e;
  });
</script>
```

## Demo 2: ClassBlue

In the above example, we only change the appearance of the element based on the presence of an attribute. When we do it like that, it is more common to use a css class.

```html

<script src="../../src/customAttributes.js"></script>
<script src="https://cdn.jsdelivr.net/gh/orstavik/ElementObserver@1.1.0/startObserver.js"></script>

<style>
  .blue {background: blue}
</style>

<h1 click:class_blue>hello sunshine</h1>

<script>
  customReactions.define("class", function (e, _, name) {
    this.ownerElement.classList.toggle(name);
    return e;
  });
</script>
```

## Demo 3: ClassBlueShort

The reaction `class_blue` is not a bad read. But, it can be even simpler. Most often in an app, there will only be one meaning of "blue" when talking about reactions. So, we can make a custom reaction that uses the `prefix`, ie. the name of the reaction itself as an attribute. This means that `class_` can be made implicit, and that we can change `click:class_blue` to `click:blue`.

```html
<script src="../../src/customAttributes.js"></script>
<script src="https://cdn.jsdelivr.net/gh/orstavik/ElementObserver@1.1.0/startObserver.js"></script>

<style>
  .blue {background: blue}
</style>

<h1 click:blue>hello sunshine</h1>

<script>
  customReactions.define("blue", function (e, prefix) {
    this.ownerElement.classList.toggle(prefix);
    return e;
  });
</script>
```

## Demo 4: FeelTheBurn

In this demo, we will illustrate the use of the ToggleReaction pattern with:

1. css variable value,
2. all the children elements, and
3. several parameters.

```html

<script src="https://cdn.jsdelivr.net/gh/orstavik/customAttributes2/src/customAttributes.js"></script>
<script src="https://cdn.jsdelivr.net/gh/orstavik/ElementObserver@1.1.0/startObserver.js"></script>

<style>
  * {user-select: none}
  span {background-color: var(--fire)}
</style>

<div click:fire_yellow_orange_red>
  <span>i</span>
  <span>burn</span>
  <span>when</span>
  <span>you</span>
  <span>multi</span>
  <span>click</span>
  <span>me</span>
</div>

<script>
  customReactions.define("fire", function (e, name, ...colors) {
    for (let child of this.ownerElement.children)
      child.style.setProperty("--" + name, colors[Math.floor(Math.random() * colors.length)]);
    return e;
  });
</script>
```

## WhatTo: return?

The ToggleReaction should return the `e` input parameter. The ToggleReaction can function as both a side-effect and end-effect (more on that later), and there is no problem just returning the input "event"/`e` as the output.

## WhatTo: look out for?

The ToggleReaction mutates the DOM. When you mutate DOM, you always want readability. You want clear control of what triggers the mutation (the trigger event, so this is fine), what is changed (an individual attribute or css class or similiar, which is fine too), and where those changes occur (a clearly defined element, such as the `.ownerElement` or the parent element, or a clearly defined set of elements that is easily and intuitively perceived in the DOM).

The good thing about reactions and the ToggleReaction pattern is that it gives a clear and direct link between the place where the mutation is done (the element on which the reaction is added), what triggers the event (the trigger event), and the change being done (the reaction name and any values).