# `cqw` is not flatDom relative

> This problem has been reported as [CSSwg-drafts issue 7947](https://github.com/w3c/csswg-drafts/issues/7947).

## Short description 

It looks like the `cqw` value is interpreted within the logical Dom context, and not the flatDom context. And this behavior seems to differ from the behavior of at least two other relative css units: `%` and `em`. Here is a test that illustrate the issue (only a single line of code is different in the three tests):

 * [test1](https://jsfiddle.net/0hfnpumq/1/)
 * [test2](https://jsfiddle.net/0hfnpumq/2/)
 * [test3](https://jsfiddle.net/0hfnpumq/3/)

```html
<web-comp>
  <h4>hello 60--wcw light slotted</h4>
</web-comp>

<style>
  body{
    font-size: 20px;
  }
  h4 {
    width: calc(60 * var(--wcw));
    border: 2px solid lightblue;
  }
</style>

<template id=wc>
  <style>
    div {
      width: 50%;
      font-size: 10px;
      container-type: inline-size;
      /*--wcw: 0.1em;*/
      /*--wcw: 1%;*/
      --wcw: 1cqw;
      border: 2px solid red;
    }
    h4 {
      width: calc(60 * var(--wcw));
      border: 2px solid orange;
    }
  </style>
  <div>
    <slot></slot>
    <h4>hello 60--wcw shadow</h4>
  </div>
</template>

<script>
  customElements.define("web-comp", class WebComp extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({mode:"open"});
      this.shadowRoot.append(document.getElementById("wc").content);
    }
  });
</script>
```

Have I misunderstood something here? Or is this expected behavior?

## WhatIs: "nearest ancestor"?

The relevant section in the spec is §6. The spec now says:
The query container for each axis is the nearest ancestor container that accepts container size queries on that axis.

The issue is: what is the algorithm for "nearest ancestor"? Now in Chrome, the nearest ancestor container is interpreted as being the nearest container that is also in the same document as the element the cqw unit is applied to. But should it not simply be "the nearest ancestor container in the flatDom", same as `%` and `em`?

This other test illustrates that the `cqw` unit is still interpreted in this document context even when it is wrapped in a css variable.
https://jsfiddle.net/xq3kjs4f/1/

Does this mean that it is impossible to access the cqw unit established in a shadowDom from the lightDom context when slotting an element?

## Example use-case:

1. We have a web component a generic carousel (or card or whatever).
2. This web comp "container" changes the width of the different slot elements (slotting contexts) depending on the available width of the host element. This happens both fluently and abruptly, as the container-query examples show, most likely using container-queries. So far, so good. So far we have used container-queries to style the shadowDom elements, and so far that is all we need.
3. But then we are going to slot elements with text and image content into the web component carousel. At this point, we start to see that we need to adapt for example the font-size of text and the border of the images to both:
   1. the element being slotted (for example a <div> element with too much text needs a smaller font size and important image needs a bigger border in red) and
   2. the size/available space of the slot into which these elements are placed (slotting context).
4. Here we would also like to use `cqw` and cq units. On the elements in the lightDom that we slot into the web component, we would like to specify the default font size to `10cqw` and image border size to `1cqw`, and then we would like to adjust font size to `8cqw` for elements with too much text and border `3cqw` for important images.