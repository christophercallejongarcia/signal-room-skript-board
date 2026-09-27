import test from "node:test";
import assert from "node:assert/strict";
import { isSafeHref, sanitizeMarkdownMedia, youtubeVideoId } from "../lib/board/markdown.ts";
import { freeSpot } from "../lib/board/layout.ts";
import { modelFrom } from "../lib/board/model.ts";

test("Markdown images and HTML media become plain links or disappear", () => {
  assert.equal(sanitizeMarkdownMedia("a ![Leck](https://evil.example/p.png?x=1) b"), "a [Leck](https://evil.example/p.png?x=1) b");
  assert.equal(sanitizeMarkdownMedia('![](https://evil.example/p.png "Titel")'), "[Bild](https://evil.example/p.png)");
  assert.equal(sanitizeMarkdownMedia("![x](javascript:alert(1))"), "x");
  assert.equal(sanitizeMarkdownMedia('Text <img src="https://evil.example/2.png"> Ende'), "Text [Medien-Link](https://evil.example/2.png) Ende");
  assert.equal(sanitizeMarkdownMedia('<iframe src="https://evil.example"></iframe>'), "[Medien-Link](https://evil.example)");
  assert.equal(sanitizeMarkdownMedia("[normaler Link](https://example.com)"), "[normaler Link](https://example.com)");
  assert.equal(isSafeHref("https://x"), true);
  assert.equal(isSafeHref("mailto:a@b.c"), true);
  assert.equal(isSafeHref("javascript:alert(1)"), false);
  assert.equal(isSafeHref("data:text/html,x"), false);
});

test("YouTube IDs from watch, youtu.be and shorts URLs, ignoring list, t and tracking", () => {
  assert.equal(youtubeVideoId("https://www.youtube.com/watch?v=DR60qPkDM2o"), "DR60qPkDM2o");
  assert.equal(youtubeVideoId("https://www.youtube.com/watch?v=DR60qPkDM2o&list=PLbpi6ZahtOH6Ar_3GPy3workNOvnYTE2Z&index=2"), "DR60qPkDM2o");
  assert.equal(youtubeVideoId("https://youtube.com/watch?t=42&v=DR60qPkDM2o"), "DR60qPkDM2o");
  assert.equal(youtubeVideoId("https://youtu.be/DR60qPkDM2o?si=abc"), "DR60qPkDM2o");
  assert.equal(youtubeVideoId("https://www.youtube.com/shorts/DR60qPkDM2o"), "DR60qPkDM2o");
  assert.equal(youtubeVideoId("https://m.youtube.com/watch?v=DR60qPkDM2o"), "DR60qPkDM2o");
  assert.equal(youtubeVideoId("youtube.com/watch?v=DR60qPkDM2o"), "DR60qPkDM2o");
  for (const bad of ["https://www.youtube.com/watch?v=kurz", "https://evil.example/watch?v=DR60qPkDM2o", "https://www.youtube.com/playlist?list=PLx", "DR60qPkDM2o", "https://www.youtube.com/watch?v=DR60qPkDM2o extra", "javascript:alert(1)"]) {
    assert.equal(youtubeVideoId(bad), null, bad);
  }
});

test("a new node never lands on top of an existing one", () => {
  const model = modelFrom([{ id: "text-a-b-AAAAA", type: "textNode", position: { x: 0, y: 0 }, width: 500, height: 300, zIndex: 1, data: { title: "" }, rev: 1 }], []);
  assert.deepEqual(freeSpot(model, { x: 100, y: 50 }, { width: 800, height: 700 }), { x: 560, y: 50 });
  assert.deepEqual(freeSpot(model, { x: 0, y: 1000 }, { width: 500, height: 300 }), { x: 0, y: 1000 });
});
