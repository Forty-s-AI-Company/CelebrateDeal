import {renderToStaticMarkup} from "react-dom/server";
import {describe,expect,it} from "vitest";
import {CourseCommunity} from "./course-community";

describe("localized exact course discussion",()=>{
 it.each(["zh-TW","en"] as const)("keeps the accepted thread and escaped author content in %s",locale=>{
  const post={id:"post_a",authorName:"發布心得",body:"原文 <script>synthetic</script>",createdAt:new Date("2026-10-07T00:00:00Z")};
  const reply={id:"reply_a",authorName:"合成回覆學員",body:"保留原文回覆",createdAt:post.createdAt};
  const html=renderToStaticMarkup(<CourseCommunity locale={locale} endpoint="/portal/academy/learn/course_a/community/data" csrfToken="synthetic" initialFeed={{course:{id:"course_a",name:"原文課程"},posts:[{...post,isPinned:false,isAnnouncement:false,replies:[reply],liked:false,likeCount:0,replyCount:1}],nextCursor:null}} initialThread={{post,replies:[reply],nextCursor:null}}/>);
  expect(html).toContain("保留原文回覆");
  expect(html).toContain("合成回覆學員");
  expect(html).toContain("發布心得");
  expect(html).toContain("&lt;script&gt;synthetic&lt;/script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain(locale==="en"?'aria-label="Reply to discussion"':'aria-label="回覆討論"');
  expect(html).toContain(locale==="en"?"Submit reply":"送出回覆");
 });
});
