import type { WebinarTemplateDefinition } from "./types";
import { template as t00 } from "./00-example";
import { template as t01 } from "./01-ai-minimal";
import { template as t02 } from "./02-saas-split";
import { template as t03 } from "./03-design-workshop";
import { template as t04 } from "./04-finance-host";
import { template as t05 } from "./05-realestate-countdown";
import { template as t06 } from "./06-travel-story";
import { template as t07 } from "./07-fitness-video";
import { template as t08 } from "./08-marketing-summit";
import { template as t09 } from "./09-career-value";
import { template as t10 } from "./10-language-series";
import { template as t11 } from "./11-healing-question";
import { template as t12 } from "./12-sustainability-ondemand";
import { template as t13 } from "./13-ecommerce-data";
import { template as t14 } from "./14-parenting-fit";
import { template as t15 } from "./15-pet-academy";
import { template as t16 } from "./16-leadership-duo";
import { template as t17 } from "./17-photo-portfolio";
import { template as t18 } from "./18-dev-tech";
import { template as t19 } from "./19-baking-craft";
import { template as t20 } from "./20-aesthetic-clinic";

/**
 * 登記檔：20 個位置已經預留，範本工作階段只要把自己的 `NN-<slug>.ts` 從 `null`
 * 改成範本定義，這裡不需要修改（避免平行工作階段互相衝突）。順序即範本庫順序。
 */
const slots: ReadonlyArray<WebinarTemplateDefinition | null> = [t01, t02, t03, t04, t05, t06, t07, t08, t09, t10, t11, t12, t13, t14, t15, t16, t17, t18, t19, t20, t00];

export const WEBINAR_TEMPLATES: readonly WebinarTemplateDefinition[] = Object.freeze(slots.filter((template): template is WebinarTemplateDefinition => template !== null));

export { webinarTemplateKit, WEBINAR_TEMPLATE_SAMPLE_MARK, type WebinarTemplateDefinition } from "./types";
