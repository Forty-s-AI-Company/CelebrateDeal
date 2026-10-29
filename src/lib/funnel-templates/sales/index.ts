import type { ConversionTemplateDefinition } from "../conversion/types";
import { template as t01 } from "./01-course-watercolor";
import { template as t02 } from "./02-digital-planner";
import { template as t03 } from "./03-coaching-luxe";
import { template as t04 } from "./04-product-coffee";
import { template as t05 } from "./05-presale-picturebook";
import { template as t06 } from "./06-saas-plans";
import { template as t07 } from "./07-tripwire-mealprep";
import { template as t08 } from "./08-service-photo";

/** 登記檔：順序即範本庫與步驟選單的順序。範本檔是 null 時不登記。 */
const slots: ReadonlyArray<ConversionTemplateDefinition | null> = [t01, t02, t03, t04, t05, t06, t07, t08];

export const SALES_TEMPLATES: readonly ConversionTemplateDefinition[] = Object.freeze(slots.filter((template): template is ConversionTemplateDefinition => template !== null));
