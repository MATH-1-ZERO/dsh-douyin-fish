export const ownerLimitDefaults={draftDailyLimit:12,draftIntervalSeconds:0,maxCharacters:100,maxEmoji:2,maxLines:2,
  modelRequestsPer24Hours:12,maxOutputTokens:160,dmDailyLimitPerContact:10,dmIntervalSeconds:300,allowOwnerDm:true,allowContactsDm:true,strangers:'ask'};
export const limitProperties={
  draftDailyLimit:{type:'integer',minimum:0,maximum:100},draftIntervalSeconds:{type:'integer',minimum:0,maximum:86400},
  maxCharacters:{type:'integer',minimum:10,maximum:300},maxEmoji:{type:'integer',minimum:0,maximum:5},maxLines:{type:'integer',minimum:1,maximum:2},
  modelRequestsPer24Hours:{type:'integer',minimum:1,maximum:100},maxOutputTokens:{type:'integer',minimum:16,maximum:1024},
  dmDailyLimitPerContact:{type:'integer',minimum:0,maximum:100},dmIntervalSeconds:{type:'integer',minimum:0,maximum:86400},
  allowOwnerDm:{type:'boolean'},allowContactsDm:{type:'boolean'},strangers:{type:'string',enum:['ask','ignore']},
};
export function validateOwnerLimits(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==Object.keys(limitProperties).length||Object.keys(value).some(k=>!Object.hasOwn(limitProperties,k)))throw Error('Invalid owner limits');
  for(const [key,schema]of Object.entries(limitProperties)){
    const v=value[key];
    if(schema.type==='integer'&&(!Number.isSafeInteger(v)||v<schema.minimum||v>schema.maximum)||schema.type==='boolean'&&typeof v!=='boolean'||schema.enum&&!schema.enum.includes(v))throw Error('Invalid owner setting: '+key);
  }
  return value;
}
export function inheritedLimits(base,profile){return validateOwnerLimits({...ownerLimitDefaults,
  maxCharacters:base.manualDrafts?.maxCharacters??100,maxEmoji:base.manualDrafts?.maxEmoji??2,
  modelRequestsPer24Hours:base.efficiency?.requestsPer24Hours??12,maxOutputTokens:base.efficiency?.maxOutputTokens??160,...profile?.limits});}
