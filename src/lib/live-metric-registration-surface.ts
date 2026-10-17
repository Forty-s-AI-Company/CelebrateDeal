import {getFunnelNodeDefinition,type FunnelNode,type PageDocument} from './funnel-page-document';
import type {FunnelStepPages} from './funnel-step-pages';
import {getFunnelWebinarState} from './funnel-webinar';

/** Mirrors the public renderer's lead-form boundary. Checkout-contact and
 * payment layouts aren't registration forms. A page with a lead form in either
 * configured viewport is a registration page (not proof of form exposure).
 * Popups are not assumed opened merely because their config exists.
 */
export function hasMetricRegistrationForm(document:PageDocument){
 const visit=(node:FunnelNode,viewport:'desktop'|'mobile'):boolean=>{
  const override=node.overrides[viewport];
  if(!(override?.visible??node.visible))return false;
  const props={...node.props,...override?.props};
  const children=node.children??[];
  if(node.type==='form'){
   if(props.variant==='checkout-contact'||children.some(child=>getFunnelNodeDefinition(child.type).category==='payment'))return false;
   return true;
  }
  return getFunnelNodeDefinition(node.type).children&&children.some(child=>visit(child,viewport));
 };
 return (['desktop','mobile'] as const).some(viewport=>document.root.some(node=>visit(node,viewport)));
}

export function metricWebinarRegistrationScope(state:FunnelStepPages,stepId:string,
 resource:{form:{id:string};live:{id:string}}|undefined,now:number=Date.now()){
 const step=state.flow.steps.find(value=>value.id===stepId);
 if(state.flow.goal!=='webinar'||!resource?.form?.id||!resource?.live?.id||!step||step.isSystem||step.type!=='webinar_registration_page'||!state.flow.steps.some(value=>value.type==='webinar_thank_you_page'))return {};
 const status=getFunnelWebinarState(state.flow.webinar,{formId:resource.form.id,liveId:resource.live.id},now);
 return ['waiting','live','replay'].includes(status.status)?{formId:resource.form.id,liveId:resource.live.id}:{};
}
