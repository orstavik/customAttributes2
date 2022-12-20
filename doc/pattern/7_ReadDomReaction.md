# Pattern: ReadDomReaction

ReadDomReactions extracts data from the DOM. When triggered, the ReadDomReactions will use a fixed algorithm and its location to extract a data from the DOM. 

## Demo 1: Form to FormData 

The default ReadDomReaction is the act of reading the content of a `<form>` html branch and turning that data into a `FormData` object.

```html
<script src="https://cdn.jsdelivr.net/combine/gh/orstavik/customAttributes2/src/customAttributes.js,gh/orstavik/ElementObserver@1.1.0/startObserver.js"></script>

<form dblclick:formdata:console.log_e>
  <h3>dblclick to console.log FormData.</h3>
  hello: <input type="text" name="hello" value="sunshine">
</form>

<script type="module">
  customReactions.define("formdata", function (e) {
    return new FormData(this.ownerElement);
  });
</script>
```

## Discussion: lazy getter or snapshot?

This data image/reading `new FormData` created is *not* a snapshot, but a wrapper with lazy getters. The FormData values are not created before they are used. We can see this in the following test:

```html
<script src="https://cdn.jsdelivr.net/combine/gh/orstavik/customAttributes2/src/customAttributes.js,gh/orstavik/ElementObserver@1.1.0/startObserver.js"></script>

<form dblclick:formdata:mutatedom:e.get_hello:console.log_e>
  <h3>dblclick to console.log FormData.</h3>
  hello: <input type="text" name="hello" value="sunshine">
</form>

<script type="module">
  customReactions.define("formdata", function (e) {
    return new FormData(this.ownerElement);
  }); customReactions.define("mutatedom", function (e) {
    this.ownerElement.children[1].value = "world";
    return e;
  });
</script>
```

In 99% of the instances, it does not matter if the data image is a snapshot or a lazy getter: e.g. the FormData is used immediately and no mutations are done to the `<form>` before use. However, if you get bugs (raceconditions) in that the data in the `FormData` object is mutated/or not up-to-date when you use it, this might be a place to look for answers.

## Implementation comments

`FormData` is *one* way to read the DOM. If your plan to use the `"multipart/formdata"` format to send data to your server, then `FormData` is the way to go.

But. This might not be the case. You might wish to send data to the server as a JSON string. If your server interaction pulls you in this direction, you should not use a `FormData` based ReadDomReaction, but instead use a ReadDomReaction that directly produce a javascript object (to be stringified) in your FetchReaction. Or used by another reaction that say updates another branch of the DOM accordingly.    

## Some philosophy

The DOM is often thought of as a simple graph of nodes: elements, text, and attributes. These elements are often considered static, unchanging. Events on the other hand are often thought of as external to the DOM and arbitrary. They might use the DOM to calculate a propagation path, so that they trigger the correct JS event listeners.

However, this perception might be a little misleading. First, we all know that the DOM is dynamic; DOM nodes can appear and disappear with high frequency. Heck, we might even add and then remove DOM nodes within the scope of a single event propagation. Second, not all events are arbitrary. On the contrary many events are fixed (cf. `DOMContentLoaded`). Third, most events *only* exist in the DOM. If there are no elements, there can be no `click` nor `load` events (cf. if there are no trees, then there can be no sound of a tree falling in the forrest).

What does this philosophical digression tell us? It tells us that we could consider events as delimited by the DOM and the DOM consisting of both nodes and events. An event and a branch of DOM often echo each other; they are two sides of the same coin. When a `submit` event is triggered on a `<form action>` element, then this `submit` event is in many ways the "eventification" of a subset of the DOM nodes in the `<form>` element.

