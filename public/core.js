/* TRACE domain model. Shared by the HTTP server and the portable demo.
 * Packet facts are immutable; human work is a separate, revisioned overlay.
 * No external service or tax engine is called. */
(function(root,factory){ if(typeof module==='object'&&module.exports) module.exports=factory(); else root.TraceCore=factory(); })(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const copy=x=>JSON.parse(JSON.stringify(x));
const round=x=>Math.round((Number(x)+Number.EPSILON)*100)/100;
const sum=xs=>round(xs.reduce((a,b)=>a+Number(b||0),0));
const human=x=>String(x||'').replace(/_/g,' ');
const areas=[
 ['intake','Intake & identity','intake_and_engagement'],['wages','Wages & stock compensation','wages_and_stock_compensation'],
 ['investments','Investments & digital assets','investments_and_digital_assets'],['business','Business','business'],
 ['rentals','Rentals & property sale','rentals_and_sale'],['passthrough','Pass-throughs & basis','pass_throughs_and_basis'],
 ['deductions','Deductions, credits & retirement','deductions_and_credits'],['california','California','california'],['completion','Completion & filing','partner_review']
];
const areaName=id=>areas.find(a=>a[0]===id)?.[1]||human(id);
function areaOf(key){
 if(/^doc:/.test(key))return 'intake';
 if(/^(F540|SchCA|FTB|ScheduleS)/.test(key))return 'california';
 if(/^(SchC|SchSE|F4562-C)/.test(key))return 'business';
 if(/^(SchE|F4797|F4562-E|F8582)/.test(key))return 'rentals';
 if(/^F7203/.test(key))return 'passthrough';
 if(/^(F8949|SchD|SchB|F8938|F8960)/.test(key))return 'investments';
 if(/^(F1040\.1a|F1040\.1z|F8959|F6251)/.test(key))return 'wages';
 if(/^(SchA|F8283|F8606|F8889|F8863|F2441|F8812|F8995|Sch1\.1[3567])/.test(key))return 'deductions';
 return 'completion';
}
function validatePacket(p){
 if(!p||!p.packet?.client_id||!Array.isArray(p.documents)||!Array.isArray(p.extracted_values)||!p.return_versions?.length||!p.firm?.staff)throw Error('Not a workpaper packet: required sections are missing.');
 for(const name of ['documents','extracted_values']){const ids=p[name].map(v=>v.id);if(new Set(ids).size!==ids.length)throw Error('Duplicate IDs in '+name);}
 for(const v of p.return_versions){if(!Array.isArray(v.lines)||!v.summary||!v.tax_effect_rates)throw Error('Incomplete return version.'); const ks=v.lines.map(l=>l.key); if(new Set(ks).size!==ks.length)throw Error('Duplicate return line keys.');}
 return p;
}
function actors(p){return [...p.firm.staff,...p.firm.client_users];}
function actor(p,id){const a=actors(p).find(a=>a.id===id);if(!a)throw Error('Unknown actor');return a;}
const hasRole=(a,rs)=>rs.includes(a.role);
const canPrepare=a=>hasRole(a,['preparer','reviewer','partner']);
const canReview=a=>hasRole(a,['reviewer','partner']);
const canInternal=a=>a.role!=='client';
function initial(p){return {
 schema:1, revision:0, contentRevision:0, packetId:p.packet.client_id, currentVersion:p.return_versions.at(-1).version,
 asOf:p.return_versions.at(-1).computed_at, branch:'Original return', adjustments:[], verification:{}, findingReviews:{}, documentReviews:{},
 notes:[], decisions:[], links:[], attachments:[], signoffs:[], approvals:[], checklist:{}, timeEntries:[], lastSeen:{},
 filing:{status:'review',submissions:[],readyRevision:null}, snapshots:[], carryforwards:[], noticeResponses:[],
 standards:copy(p.firm.starter_standards), audit:[]
};}
const indexCache=new WeakMap();
function indexes(p,version){const v=p.return_versions.find(v=>v.version===version)||p.return_versions.at(-1);let cache=indexCache.get(p);if(!cache){cache={};indexCache.set(p,cache);}if(cache[v.version])return cache[v.version];return cache[v.version]={v,lines:Object.fromEntries(v.lines.map(l=>[l.key,l])),ev:Object.fromEntries(p.extracted_values.map(e=>[e.id,e])),docs:Object.fromEntries(p.documents.map(d=>[d.id,d]))};}
function available(p,s,id){
 const {docs,ev}=indexes(p,s.currentVersion);
 let doc=docs[id]||docs[ev[id]?.document_id];
 if(id.startsWith('doc:'))doc=docs[id.slice(4).split('#')[0]];
 if(doc)return doc.received_at<=s.asOf;
 const item=[...p.client.messages,...p.client.questionnaire,...p.client.call_notes].find(m=>m.id===id);
 if(item)return (item.sent_at||item.answered_at||item.date)<=s.asOf;
 if(id.startsWith('agency:')){const record=resolveRef(p,id,s.currentVersion).item;const date=record?.dated||record?.as_of||record?.date;if(date)return date<=s.asOf;}
 return true;
}
function fingerprint(obj){let h=2166136261; for(const c of JSON.stringify(obj)){h^=c.charCodeAt(0); h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');}
const override=(s,key)=>s.adjustments.filter(a=>!a.undone).flatMap(a=>a.patches||[]).filter(a=>a.target===key).at(-1);
function value(p,s,key,version){const ix=indexes(p,version||s.currentVersion);const change=(!version||version===s.currentVersion)?override(s,key):null;if(change)return change.value;return ix.lines[key]?.value??ix.ev[key]?.value;}
const exactSums=new Set(['SchB.2','SchB.4','SchB.6','SchC.5','SchC.7','SchC.28','SchD.1b','SchD.2','SchD.3','SchD.7','SchD.8b','SchD.9','SchD.10','SchD.11','SchD.15','SchD.16','SchA.5d','SchA.7','SchA.8e','SchA.10','SchA.12','SchA.14','SchA.17','SchE.20A','SchE.20B','SchE.26','SchE.32','SchE.41','Sch1.10','Sch1.26','F1040.1z','F1040.9','F1040.14','F1040.18','F1040.23','F1040.24','F1040.25d','F1040.33','Sch3.15','F7203.4','F7203.5','F8606.3','F8606.9']);
const subtract=new Set(['SchC.29','SchC.31','SchE.21A','SchE.21B','F1040.11','F1040.15','F1040.22','F1040.37','F4797.24','F4797.25']);
function effectiveLines(p,s,version){
 const ix=indexes(p,version||s.currentVersion),out={},visiting=new Set(),live=!version||version===s.currentVersion;
 function calc(key){if(out[key])return out[key]; const line=ix.lines[key];if(!line)return null;
  if(visiting.has(key))return {...line,stale:true,original:line.value}; visiting.add(key);
  const direct=live?override(s,key):null;
  const ins=(line.inputs||[]).map(calc).filter(Boolean);
  const changed=ins.some(l=>l.value!==l.original||l.stale);
  const sourceChanged=live&&(line.sources||[]).some(ref=>!!override(s,ref));
  let result={...line,original:line.value,value:direct?direct.value:line.value,direct:!!direct,derived:false,stale:false};
  if(!direct&&(changed||sourceChanged)){
   const numeric=ins.length&&ins.every(l=>typeof l.value==='number'&&typeof l.original==='number'&&!l.stale);
   if(!sourceChanged&&numeric&&(exactSums.has(key)||(line.rule==='R-CARRY'&&ins.length===1))){result.value=round(line.value+sum(ins.map(l=>l.value-l.original)));result.derived=true;}
   else if(!sourceChanged&&numeric&&subtract.has(key)&&ins.length>=2){result.value=round(line.value+(ins[0].value-ins[0].original)-sum(ins.slice(1).map(l=>l.value-l.original)));result.derived=true;}
   else if(!sourceChanged&&numeric&&key==='SchC.9'){result.value=Math.round(ins[0].value*p.engine_reference.parameters.mileage_rate);result.derived=true;}
   else result.stale=true;
  }
  out[key]=result;visiting.delete(key);return result;
 }
 ix.v.lines.forEach(l=>calc(l.key)); if(live)for(const a of s.adjustments.filter(a=>!a.undone))for(const t of a.patches.filter(t=>t.target.startsWith('manual:')))out[t.target]={key:t.target,form:'Manual',line:t.target.slice(7),jurisdiction:'federal',label:'Documented manual entry '+t.target.slice(7),original:null,value:t.value,direct:true,derived:false,stale:false,inputs:[],sources:a.refs,rule:'REVIEW-MANUAL',note:'Not in the supplied engine. Downstream form mapping is not automatically recomputed; see adjustment effect ledger.'}; return Object.values(out);
}
function effect(p,s,category,delta,caMode='default'){
 const r=indexes(p,s.currentVersion).v.tax_effect_rates;
 if(category==='federal_payment')return {federal:0,california:0,federalPayment:round(delta),californiaPayment:0};
 if(category==='california_payment')return {federal:0,california:0,federalPayment:0,californiaPayment:round(delta)};
 if(category==='federal_credit')return {federal:round(-delta),california:0,federalPayment:0,californiaPayment:0};
 if(category==='california_credit')return {federal:0,california:round(-delta),federalPayment:0,californiaPayment:0};
 if(category==='none')return {federal:0,california:0,federalPayment:0,californiaPayment:0};
 if(!r[category])throw Error('Select a supported tax-effect category.');
 const ca=caMode==='none'?0:caMode==='source'?r.ca_source_income.california_per_dollar:r[category].california_per_dollar;
 return {federal:round(delta*r[category].federal_per_dollar),california:round(delta*ca),federalPayment:0,californiaPayment:0};
}
function totals(p,s){const b=copy(indexes(p,s.currentVersion).v.summary);let e={federal:0,california:0,federalPayment:0,californiaPayment:0};for(const a of s.adjustments.filter(a=>!a.undone))for(const k of Object.keys(e))e[k]=round(e[k]+(a.effect[k]||0));return {base:b,effect:e,federal:round(b.federal.total_tax+e.federal),california:round(b.california.total_tax+e.california),federalBalance:round(b.federal.balance_due+e.federal-e.federalPayment),californiaBalance:round(b.california.balance_due+e.california-e.californiaPayment)};}
function descendants(p,key,version){const ix=indexes(p,version),seen=new Set(),queue=[key];while(queue.length){const q=queue.shift();for(const l of ix.v.lines){if((l.inputs||[]).includes(q)||(l.sources||[]).includes(q)){if(!seen.has(l.key)){seen.add(l.key);queue.push(l.key);}}}}return [...seen];}
function evidence(p,key,version,depth=0,seen=new Set()){
 const ix=indexes(p,version);if(depth>30||seen.has(key))return [];seen.add(key);
 const l=ix.lines[key];if(l)return [...new Set([...(l.sources||[]),...(l.inputs||[]).flatMap(k=>evidence(p,k,version,depth+1,seen))])];return [key];
}
function resolveRef(p,ref,version){
 const ix=indexes(p,version);if(ix.ev[ref])return {type:'value',item:ix.ev[ref],document:ix.docs[ix.ev[ref].document_id]};
 if(ix.docs[ref])return {type:'document',item:ix.docs[ref]};
 if(ix.lines[ref])return {type:'line',item:ix.lines[ref]};
 if(ref.startsWith('doc:')){let [id,pg]=ref.slice(4).split('#page');return {type:'document',item:ix.docs[id],page:Number(pg||1)};}
 const msg=[...p.client.messages,...p.client.questionnaire,...p.client.call_notes].find(m=>m.id===ref);if(msg)return {type:'evidence',item:msg};
 if(ref.startsWith('asset:'))return {type:'record',item:ix.v.assets.find(a=>a.asset_id===ref.slice(6))||p.prior_years.asset_records.find(a=>a.asset_id===ref.slice(6))};
 if(ref.startsWith('household:'))return {type:'record',item:p.household.people.find(a=>a.id===ref.slice(10))};
 if(ref.startsWith('timeline:'))return {type:'record',item:p.timeline.find(t=>t.id===ref.slice(9))};
 if(ref.startsWith('py:')||ref.startsWith('agency:')){let obj=ref.startsWith('py:')?p.prior_years:p.tax_agency_records;for(const part of ref.split(':').slice(1).join(':').split('/').filter(Boolean)){obj=obj?.[part.replace(/~1/g,'/').replace(/~0/g,'~')];}return {type:'record',item:obj};}
 if(ref.startsWith('ref:param.'))return {type:'record',item:p.engine_reference.parameters[ref.slice(10)]};
 if(ref.startsWith('ref:fx.SEK.'))return {type:'record',item:p.engine_reference.parameters.fx?.SEK?.[ref.slice(11)]||p.fx_rates.SEK_per_USD?.[ref.slice(11)]};
 return {type:'unresolved',item:ref};
}
function inspect(p,s){
 const ix=indexes(p,s.currentVersion),v=ix.v,L=ix.lines,E=ix.ev,D=ix.docs,result=[];
 const get=(doc,field)=>p.extracted_values.find(e=>e.document_id===doc&&e.field===field);
 const put=o=>{if(o.refs?.some(r=>!available(p,s,r)))return;result.push({kind:'confirmed',severity:'high',origin:'Independent check',blocking:true,...o});};
 const mk=(target,value)=>({target,value});
 // Independent cross-document basis matching, rather than confidence-based review.
 const lots=[['F8949.B.N1','RSU-2502_adjusted_basis','stcg','source'],['F8949.B.N3','RSU-2505_adjusted_basis','stcg','source'],['F8949.E.N4','RSU-2308_adjusted_basis','ltcg','default']];
 for(const [key,basisField,category,caMode] of lots){const b=get('D11',basisField);if(!L[key]||!b)continue;const proceeds=L[key].sources.map(r=>E[r]).find(e=>e?.field.endsWith('_proceeds'));
 if(proceeds&&L[key].value===proceeds.value&&b.value>0)put({id:'RSU_'+key.split('.').at(-1),area:'wages',title:'Stock basis omitted: '+key.split('.').at(-1),detail:`The stock-plan supplement supports an adjusted basis of $${b.value.toLocaleString()}. The engine reports the full proceeds as gain. A 98% confidence extraction is not verification of tax basis.`,refs:[b.id,...L[key].sources,'doc:D11#page2','doc:D28#page3'],key,patches:[mk(key,round(proceeds.value-b.value))],effects:[{category,delta:-b.value,caMode}],rule:'Match acquisition date and lot to D11 adjusted basis; proceeds minus adjusted basis.'});}
 if(L['SchB.1.1']?.value===L['SchB.1.2']?.value&&/7731/.test(D.D29.pages[0].printed_content))put({id:'SWEEP_DUPLICATE',area:'investments',title:'One bank-sweep payment counted twice',detail:'Northlake Securities and Northlake Bank identify the same sweep program and account ending 7731. Both interest lines include $1,840.',refs:['ev-0492','ev-0538','doc:D28#page1','doc:D29#page1'],key:'SchB.1.2',patches:[mk('SchB.1.2',0)],effects:[{category:'interest',delta:-1840}],rule:'Same account + same payer program + same interest; retain one economic item.'});
 const fxL=L['SchB.1.6'],fx=get('D36','interest_sek')||E['ev-0960'];const rate=p.fx_rates.SEK_per_USD['2025_average'];if(fxL?.sources.some(r=>r.includes('2024_average'))&&fx)put({id:'FX_YEAR',area:'investments',title:'2025 interest uses the 2024 exchange rate',detail:`SEK ${fx.value.toLocaleString()} was converted at 10.56 SEK/USD. The supplied 2025 average is ${rate}; this produces $${Math.round(fx.value/rate).toLocaleString()}.`,refs:fxL.sources.concat(['ref:fx.SEK.2025_average']),key:fxL.key,patches:[mk(fxL.key,Math.round(fx.value/rate))],effects:[{category:'interest',delta:Math.round(fx.value/rate)-fxL.value}],rule:'Use the packet\'s 2025 average exchange rate. No external FX feed.'});
 const mileage=D.D23?.pages||[],canonical=new Set();let uniqueMiles=0,dups=[];
 for(const page of mileage){let t=page.printed_content.replace(/^\(Second scan[^)]*\)\s*/,'').trim();const found=t.match(/Page total ([\d,]+) miles/);if(!found)continue;const key=t.split('Page total')[0];if(canonical.has(key))dups.push(page.page);else {canonical.add(key);uniqueMiles+=Number(found[1].replace(/,/g,''));}}
 if(dups.length&&uniqueMiles!==L['SchC.44a']?.value){let delta=round((L['SchC.44a'].value-uniqueMiles)*p.engine_reference.parameters.mileage_rate);put({id:'MILEAGE_DUPLICATE',area:'business',title:'Mileage page 3 repeats page 2',detail:`Unique page totals are 2,600 + 3,700 + 1,800 = ${uniqueMiles.toLocaleString()} miles. The engine counts 11,800. The duplicated 3,700 miles create $${delta.toLocaleString()} of excess expense at the packet rate.`,refs:['doc:D23#page2','doc:D23#page3','ev-0226','ev-0315','ev-0404','ev-0477'],key:'SchC.44a',patches:[mk('SchC.44a',uniqueMiles)],effects:[{category:'schc_profit',delta}],rule:'Deduplicate identical page content, then independently add page totals.'});}
 if(L['SchC.1']?.value===163700&&/12,400\.00 arrived through Paywell/.test(D.D15.pages[2].printed_content))put({id:'CARD_REVENUE_DUPLICATE',area:'business',title:'Card revenue is already in the books',detail:'The engine adds the $12,400 Paywell Form 1099-K to $151,300 of book revenue. D15 confirms that the card deposits are already included in Sales - client projects.',refs:['doc:D14#page1','doc:D15#page3','doc:D21#page1'],key:'SchC.1',patches:[mk('SchC.1',151300)],effects:[{category:'schc_profit',delta:-12400}],rule:'Reconcile payment channels to booked revenue; do not add the same revenue again.'});
 if(available(p,s,'call-01')){
 put({id:'UTILITIES_PERSONAL',area:'business',title:'Family phone and internet treated as 100% business',detail:'The client call records 70% business use of the $2,160 phone plan and 50% of $1,320 home internet: $2,172 combined, not $3,480. Client estimates require reviewer acceptance.',kind:'judgment',refs:['call-01','doc:D15#page2','ev-0101','ev-0095'],key:'SchC.25',patches:[mk('SchC.25',2172)],effects:[{category:'schc_profit',delta:1308}],rule:'Client evidence supplies business-use percentages; reviewer must accept substantiation.'});
 put({id:'PERSONAL_SUBSCRIPTION',area:'business',title:'Personal Spotify Family subscription in expenses',detail:'D15 lists $216 for Spotify Family. The March 26 call explicitly says it is personal and was booked by mistake.',refs:['call-01','doc:D15#page1','ev-0099'],key:'SchC.27a.1',patches:[mk('SchC.27a.1',6634)],effects:[{category:'schc_profit',delta:216}],rule:'Remove the identified personal item, retaining the source and the client explanation.'});
 }
 const ein=get('D62','ein'),printedEin=D.D62.pages[0].printed_content.match(/Tax ID ([\d-]+)/)?.[1];if(ein&&printedEin&&ein.value!==printedEin)put({id:'PROVIDER_EIN',area:'deductions',title:'Childcare provider tax ID was transposed',detail:`D62 prints ${printedEin}; extraction read ${ein.value} with ${Math.round(ein.confidence*100)}% confidence. The return label inherited the wrong ID.`,refs:[ein.id,'doc:D62#page1'],key:ein.id,patches:[mk(ein.id,printedEin)],effects:[],rule:'Compare the exact printed identifier with the extracted identifier; no monetary effect.'});
 const transcript=p.tax_agency_records.irs_account_transcript_2025.find(t=>t.as_of<=s.asOf),paid=transcript?sum(transcript.transactions.filter(t=>t.code==='670'&&t.description==='Estimated tax payment').map(t=>t.amount)):null;
 if(paid!==null&&L['F1040.26'].value!==paid)put({id:'FEDERAL_PAYMENTS',area:'completion',title:'Estimated payments exceed the IRS record',detail:`The engine includes $${L['F1040.26'].value.toLocaleString()}. The supplied pre-filing transcript has four payments of $3,000, totaling $${paid.toLocaleString()}.`,refs:['agency:/irs_account_transcript_2025/0','doc:D67#page1','qa-41'],key:'F1040.26',patches:[mk('F1040.26',paid)],effects:[{category:'federal_payment',delta:paid-L['F1040.26'].value}],rule:'Sum agency-confirmed payments for the correct tax period; payments affect balance, not tax.'});
 const caPay=v.lines.find(l=>l.jurisdiction==='california'&&/Estimated tax payments/i.test(l.label));const ftbPaid=sum(p.tax_agency_records.ftb_account.tax_year_2025_payments.map(x=>x.amount));
 if(caPay&&caPay.value!==ftbPaid)put({id:'CA_PAYMENT_YEAR',area:'california',title:'A California payment belongs to tax year 2024',detail:`The engine includes $${caPay.value.toLocaleString()}. The FTB account credits $${ftbPaid.toLocaleString()} to 2025; the September $3,500 is held against 2024. A transfer is not assumed.`,refs:['agency:/ftb_account','doc:D68#page1'],key:caPay.key,patches:[mk(caPay.key,ftbPaid)],effects:[{category:'california_payment',delta:ftbPaid-caPay.value}],rule:'Match payment amount, posting date AND tax year; track a requested transfer separately.'});
 if(L['SchA.8a']?.value===21847)put({id:'PAYOFF_INTEREST_DUPLICATE',area:'deductions',title:'Home-loan payoff interest counted again',detail:'D55 says its $13,900 mortgage interest includes payoff interest. D56 repeats $2,150 and explicitly says it is reported on Form 1098. The engine adds it again.',refs:['doc:D55#page1','doc:D56#page1','doc:D57#page1','SchA.8a'],key:'SchA.8a',patches:[mk('SchA.8a',19697)],effects:[{category:'itemized',delta:-2150}],rule:'Reconcile payoff statement to the annual Form 1098; exclude the duplicate interest component.'});
 put({id:'MISSING_BROKER_PAGE',area:'investments',title:'Meridian page 32 never reached the return',detail:'The current corrected statement D31 is partially extracted. Page 32 shows M18 proceeds $250 and basis $310 (short-term, noncovered). The engine has no M18 line. Add the omitted lot through a documented manual line.',refs:['doc:D31#page32','doc:D31#page1'],kind:'confirmed',key:'SchD.2',patches:[mk('manual:M18',-60)],effects:[{category:'stcg',delta:-60}],rule:'Page completeness + summary-to-lot reconciliation. Manual lot retained separately; engine recomputation is required for its downstream form mapping.'});
 put({id:'CRYPTO_BASIS',area:'investments',kind:'judgment',severity:'high',title:'Transferred crypto: unknown is not zero',detail:'Coinhaven C6 has unknown cost and a transfer-in date. The engine treats these as zero basis and an acquisition date. Obtain original purchase evidence before accepting the gain or holding period. Later client evidence is available only after timeline replay.',refs:['doc:D35#page1','ev-0918','ev-0919'],key:'F8949.H.C6',rule:'Missing basis is a review obligation, not an invented basis value.'});
 put({id:'VEHICLE_GIFT',area:'deductions',kind:'judgment',title:'Vehicle gift value conflicts with sale proceeds',detail:'The workpaper engine uses the client\'s $6,000 estimate. Form 1098-C reports a $2,900 arm\'s-length sale. A reviewer must document the deduction treatment and authority; this check does not invent tax law.',refs:['qa-39','doc:D66#page1','F8283.A1.vehicle'],key:'F8283.A1.vehicle',rule:'Compare donor estimate to the charity acknowledgment; document authority before adjusting.'});
 put({id:'HOME_PROPERTY_TAX_CREDIT',area:'deductions',kind:'judgment',severity:'medium',title:'Home property tax has an unreconciled seller credit',detail:'The engine takes the full $13,420 home tax payment. The purchase settlement also records a $6,912 seller credit for the prior ownership period. Reconcile the allocation and record the deduction treatment.',refs:['doc:D54#page1','doc:D57#page1','doc:D58#page1','SchA.5b'],key:'SchA.5b',rule:'Reconcile settlement credits and escrow cash flow before determining the deductible share.'});
 put({id:'HVAC_TREATMENT',area:'rentals',kind:'judgment',title:'Full HVAC replacement is in repair expense',detail:'The invoice describes a replacement heat-pump system, not a minor service repair. Review repair versus capitalization and use the supplied HVAC what-if as a separate, base-v3 scenario.',refs:['doc:D46#page1','doc:D47#page1','call-01','SchE.14A'],key:'SchE.14A',scenario:'hvac_improvement',rule:'Record judgment and authority; the packet supplies an exact alternative for the unadjusted v3 base.'});
 put({id:'CHARITY_AMBIGUOUS',area:'deductions',kind:'judgment',severity:'medium',title:'Handwritten donation amount needs confirmation',detail:'D64 shows an ambiguous first digit and no goods-or-services line. A low-confidence read of $1,500 is not sufficient substantiation. The later client message is future evidence until replayed.',refs:['ev-1049','doc:D64#page1'],key:'SchA.11',rule:'Retain uncertainty; request clarification and supporting acknowledgment rather than auto-correcting.'});
 put({id:'CA_WAGES_SOURCE',area:'california',kind:'judgment',title:'California wages need a documented source split',detail:'D09 kept California as the payroll work state through September. D73 provides a July 15 year-to-date California taxable wage amount of $22,469. Reconcile it with residency and the engine\'s allocation.',refs:['doc:D09#page1','doc:D73#page1','qa-03','qa-45'],key:'SchCA540NR.1a.E',rule:'Use residency dates, work-location evidence and paystub taxable wages; do not confuse withholding with income sourcing.'});
 put({id:'BASIS_HISTORY',area:'passthrough',kind:'judgment',severity:'medium',title:'Historical basis gaps need reviewer closure',detail:'The prior preparer left 2023 Woodworks basis unrolled and assumed 2024 basis was sufficient. D40 now exists; v3 begins at $2,300. Preserve the reconciliation and separately address the missing Ridgeline outside-basis history.',refs:['doc:D07#page2','doc:D40#page1','py:/basis_records','F7203.1'],rule:'This is an unresolved review obligation, not a claim that v3\'s $2,300 is wrong.'});
 put({id:'IDENTITY_CONFLICT',area:'intake',kind:'judgment',title:'Dependent identifier disagrees with prior-year record',detail:'Theo\'s organizer identifier differs from the filed 2024 return. Do not assume either is authoritative. Request primary evidence; the later card and rejection events are scripted future evidence.',refs:['household:theo','py:/return_2024/dependents','doc:D06#page1'],rule:'Compare identifiers across years, then resolve from primary evidence with restricted access.'});
 // Independent current-version reference and subtotal controls.
 for(const d of v.diagnostics){result.push({id:'ENGINE_'+d.code,area:areaOf(d.refs?.find(r=>L[r])||''),title:human(d.code),detail:d.message,refs:d.refs||[],origin:'Engine diagnostic',kind:'diagnostic',severity:d.severity==='warning'?'medium':'info',blocking:d.severity==='warning',rule:'Supplied engine diagnostic. Independent findings are listed separately.'});}
 return result.map(x=>{const review=s.findingReviews[x.id];return {...x,status:review?.status||'open',review,adjustment:s.adjustments.find(a=>!a.undone&&a.findingId===x.id)};});
}
function variances(p,s){const py=p.prior_years.return_2024.lines,rule=s.standards.variance_review;return indexes(p,s.currentVersion).v.lines.filter(l=>typeof l.value==='number'&&typeof py[l.key]==='number').map(l=>({...l,prior:py[l.key],delta:round(l.value-py[l.key]),percent:py[l.key]===0?null:Math.abs((l.value-py[l.key])/py[l.key]*100)})).filter(l=>Math.abs(l.delta)>rule.and_over_amount&&(l.percent===null||l.percent>rule.flag_if_change_over_percent));}
function blockers(p,s){const out=[];
 const fs=inspect(p,s).filter(i=>i.blocking&&i.status!=='resolved'&&i.status!=='accepted');if(fs.length)out.push(`${fs.length} blocking findings need a documented resolution`);
 const ns=s.notes.filter(n=>n.blocking&&n.status!=='resolved');if(ns.length)out.push(`${ns.length} open blocking review notes`);
 const docs=p.documents.filter(d=>available(p,s,d.id));const missing=docs.filter(d=>!s.documentReviews[d.id]);if(missing.length)out.push(`${missing.length} available documents are not accounted for`);
 const vars=variances(p,s).filter(v=>!s.decisions.some(d=>d.target===v.key&&d.kind==='variance'));if(vars.length)out.push(`${vars.length} prior-year variances need explanations`);
 const steps=s.standards.required_steps.filter(x=>!['All documents accounted for','Prior-year variances explained','Diagnostics resolved','Reviewer sign-off','Partner sign-off','Client approval and e-file authorization'].includes(x));const un=steps.filter(k=>!s.checklist[k]?.done);if(un.length)out.push(`${un.length} required preparation steps remain`);
 for(const role of ['reviewer','partner']){const count=areas.filter(([id])=>!s.signoffs.some(x=>x.area===id&&x.level===role&&x.valid&&x.contentRevision===s.contentRevision)).length;if(count)out.push(`${role}: ${count} areas not signed off`);}
 if(s.approvals.filter(a=>a.valid&&a.contentRevision===s.contentRevision).map(a=>a.actor).filter((a,i,all)=>all.indexOf(a)===i).length<p.firm.client_users.length)out.push('Both clients must approve this exact revision');
 return out;
}
function apply(p,input,who,action,ctx={}){
 validatePacket(p);const a=typeof who==='string'?actor(p,who):who,s=copy(input),{type,payload:q={}}=action;
 const at=ctx.at||new Date().toISOString(),id=ctx.id||'evt-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
 const requireRole=rs=>{if(!hasRole(a,rs))throw Error('Your current role cannot perform this action.');};
 const need=(v,msg)=>{if(!v)throw Error(msg);};const text=(v,label)=>{need(typeof v==='string'&&v.trim().length>=3,`${label} is required (at least 3 characters).`);need(v.length<=20000,`${label} is too long.`);return v.trim();};
 const references=refs=>{need(Array.isArray(refs)&&refs.length>0,'Link at least one source, record or return line.');for(const r of refs){need(typeof r==='string'&&r.length<300,'Invalid reference.');need(available(p,s,r),'Future evidence cannot be used before its replay date.');const resolved=resolveRef(p,r,s.currentVersion);need((resolved.type!=='unresolved'&&resolved.item!==undefined)||s.attachments.some(x=>x.id===r)||(r.startsWith('manual:')&&override(s,r)),'Unknown evidence reference: '+r);}return refs;};
 const writeTypes=['adjust','undo','verify','finding','document','checklist','decision','link','attach','resolve_note','replay'];
 if(['submitted','accepted'].includes(s.filing.status)&&writeTypes.includes(type))throw Error('This filing is frozen. Start an amendment to make changes.');
 let content=false,label='',detail={};
 if(type==='adjust'){
  requireRole(['preparer','reviewer','partner']);const reason=text(q.reason,'Adjustment reason');const refs=references(q.refs);
  need(Array.isArray(q.patches)&&q.patches.length>0&&q.patches.length<100,'Provide 1 to 99 patches.');
  const ix=indexes(p,s.currentVersion),seen=new Set();
  const patches=q.patches.map(t=>{need(!seen.has(t.target),'A field may be patched once per adjustment.');seen.add(t.target);need(typeof t.target==='string'&&(ix.lines[t.target]||ix.ev[t.target]||/^manual:[A-Za-z0-9_-]{1,40}$/.test(t.target)),'Unknown adjustment target.');need(['string','number','boolean'].includes(typeof t.value),'Unsupported value type.');if(typeof t.value==='number')need(Number.isFinite(t.value)&&Math.abs(t.value)<1e12,'Invalid numeric amount.');return {...t,old:value(p,s,t.target)??null};});
  // Avoid two overlays estimating the same tax change independently.
  const active=s.adjustments.filter(x=>!x.undone);
  need(!active.some(x=>x.patches.some(old=>patches.some(n=>n.target===old.target))),'This target already has an active adjustment. Undo that adjustment before replacing it.');
  let eff={federal:0,california:0,federalPayment:0,californiaPayment:0};
  for(const e of q.effects||[]){need(Number.isFinite(e.delta),'Effect delta must be numeric.');const t=effect(p,s,e.category,e.delta,e.caMode);for(const k of Object.keys(eff))eff[k]=round(eff[k]+t[k]);}
  if(q.scenario){const w=p.what_if.alternatives.find(w=>w.id===q.scenario);need(w&&w.base_version===s.currentVersion,'Scenario does not match this engine version.');need(active.length===0,'Precomputed alternatives cannot be stacked on adjusted returns. Undo active adjustments to use this scenario.');eff={federal:w.federal.total_tax_change||0,california:w.california.total_tax_change||0,federalPayment:0,californiaPayment:0};}
  need(!active.some(x=>x.scenario),'Undo the precomputed scenario before applying other changes.');
  s.adjustments.push({id,actor:a.id,at,branch:s.branch,version:s.currentVersion,reason,refs,patches,effect:eff,effectInputs:q.effects||[],findingId:q.findingId||null,scenario:q.scenario||null,area:q.area||areaOf(patches[0].target),undone:false});
  if(q.findingId)s.findingReviews[q.findingId]={status:'in_review',reason,refs,actor:a.id,at};content=true;label='Adjustment recorded';detail={patches,effect:eff,reason,refs};
 }else if(type==='undo'){
  requireRole(['preparer','reviewer','partner']);const adj=s.adjustments.find(x=>x.id===q.id);need(adj&&!adj.undone,'Adjustment is not active.');need(adj.branch===s.branch,'Filed-branch adjustments cannot be undone from an amendment.');adj.undone=true;adj.undoneBy=a.id;adj.undoneAt=at;adj.undoReason=text(q.reason,'Undo reason');if(adj.findingId)delete s.findingReviews[adj.findingId];content=true;label='Adjustment reversed; original retained';detail={adjustment:q.id,reason:adj.undoReason};
 }else if(type==='verify'){
  requireRole(['preparer','reviewer','partner']);need(Array.isArray(q.targets)&&q.targets.length<=100&&q.targets.length>0,'Select up to 100 items.');need(s.standards.verification_types.includes(q.method),'Select a verification method.');const note=text(q.note,'Verification note'),refs=references(q.refs);
  q.targets.forEach(t=>{need(resolveRef(p,t,s.currentVersion).type!=='unresolved','Unknown verification target');s.verification[t]={actor:a.id,at,method:q.method,note,refs,value:effectiveLines(p,s).find(l=>l.key===t)?.value??value(p,s,t)??null,valid:true};});content=true;label='Evidence verified';detail={targets:q.targets,method:q.method,note};
 }else if(type==='document'){
  requireRole(['preparer','reviewer','partner']);need(['used','duplicate','superseded','reference','not_applicable'].includes(q.status),'Choose a document disposition.');const reason=text(q.reason,'Document disposition reason');need(Array.isArray(q.ids)&&q.ids.length&&q.ids.length<=100,'Choose documents.');q.ids.forEach(d=>{need(p.documents.some(x=>x.id===d)&&available(p,s,d),'Document is unavailable');s.documentReviews[d]={status:q.status,reason,actor:a.id,at};});content=true;label='Documents accounted for';detail={ids:q.ids,status:q.status,reason};
 }else if(type==='finding'){
  requireRole(['preparer','reviewer','partner']);need(inspect(p,s).some(f=>f.id===q.id),'Unknown finding');need(['open','in_review','resolved','accepted'].includes(q.status),'Invalid finding status');if(['resolved','accepted'].includes(q.status))requireRole(['reviewer','partner']);const reason=text(q.reason,'Resolution rationale'),refs=references(q.refs);s.findingReviews[q.id]={status:q.status,reason,refs,actor:a.id,at};content=true;label='Finding disposition updated';detail={...s.findingReviews[q.id],finding:q.id};
 }else if(type==='note'){
  requireRole(['preparer','reviewer','partner','client','quality_reviewer']);const body=text(q.text,'Note');const kind=q.kind||'review';need(['review','question','reply'].includes(kind),'Unknown note type');if(a.role==='client')need(kind==='reply'&&s.notes.some(n=>n.id===q.parent&&n.clientVisible),'Clients can reply only to shared questions.');
  const refs=q.refs?.length?references(q.refs):[];s.notes.push({id,actor:a.id,at,text:body,kind,parent:q.parent||null,target:q.target||null,area:q.area||'completion',assignedTo:q.assignedTo||null,due:q.due||null,blocking:a.role==='client'?false:!!q.blocking,clientVisible:a.role==='client'||!!q.clientVisible,status:'open',refs});content=true;label=kind==='reply'?'Evidence reply received':'Review note created';detail={text:body,kind,blocking:q.blocking,target:q.target};
 }else if(type==='resolve_note'){
  requireRole(['reviewer','partner']);let n=s.notes.find(x=>x.id===q.id);need(n,'Note not found');n.status='resolved';n.resolution=text(q.reason,'Resolution');n.resolvedBy=a.id;n.resolvedAt=at;content=true;label='Review note closed';detail={note:n.id,resolution:n.resolution};
 }else if(type==='decision'){
  requireRole(['preparer','reviewer','partner']);const body=text(q.text,'Decision'),authority=text(q.authority,'Authority or supplied reference');const refs=references(q.refs);s.decisions.push({id,actor:a.id,at,kind:q.kind||'judgment',target:q.target||null,area:q.area||areaOf(q.target||''),text:body,authority,refs});content=true;label='Professional judgment recorded';detail={kind:q.kind,target:q.target,authority};
 }else if(type==='checklist'){
  requireRole(['preparer','reviewer','partner']);need(s.standards.required_steps.includes(q.step),'Unknown step');need(!['All documents accounted for','Prior-year variances explained','Diagnostics resolved','Reviewer sign-off','Partner sign-off','Client approval and e-file authorization'].includes(q.step),'This step is computed from the underlying work.');s.checklist[q.step]={done:!!q.done,note:text(q.note,'Completion evidence'),refs:references(q.refs),actor:a.id,at};content=true;label='Preparation checkpoint updated';detail={step:q.step,done:q.done};
 }else if(type==='signoff'){
  requireRole(['reviewer','partner']);need(areas.some(x=>x[0]===q.area),'Unknown area');const level=a.role;
  const prepared=[...s.adjustments.filter(x=>!x.undone),...s.decisions,...Object.entries(s.verification).flatMap(([key,v])=>[areaOf(key),...descendants(p,key,s.currentVersion).map(areaOf)].map(area=>({...v,area})))].some(x=>x.actor===a.id&&x.area===q.area);
  need(!prepared,'You cannot sign off on work you prepared. Switch to an independent reviewer.');
  need(!inspect(p,s).some(f=>f.area===q.area&&f.blocking&&!['resolved','accepted'].includes(f.status)),'Resolve or formally accept this area\'s findings first.');
  need(!s.notes.some(n=>n.area===q.area&&n.blocking&&n.status!=='resolved'),'Open blocking notes remain in this area.');
  if(level==='partner')need(s.signoffs.some(x=>x.area===q.area&&x.level==='reviewer'&&x.valid&&x.contentRevision===s.contentRevision),'Independent reviewer sign-off is required first.');
  need(!s.signoffs.some(x=>x.area===q.area&&x.level===level&&x.valid&&x.contentRevision===s.contentRevision),'This revision is already signed at that level.');
  s.signoffs.push({id,actor:a.id,at,area:q.area,level,contentRevision:s.contentRevision,valid:true,note:text(q.note,'Sign-off note')});label=areaName(q.area)+' signed by '+level;detail={area:q.area,level,contentRevision:s.contentRevision};
 }else if(type==='client_ready'){
  requireRole(['partner']);const bs=blockers(p,s).filter(x=>!x.startsWith('Both clients'));need(!bs.length,'Not ready: '+bs.join('; '));s.filing.readyRevision=s.contentRevision;label='Revision released for client approval';detail={contentRevision:s.contentRevision};
 }else if(type==='approve'){
  requireRole(['client']);need(s.filing.readyRevision===s.contentRevision,'The partner must release this revision for approval first.');need(q.signature===a.name,'Type your complete name exactly as displayed.');need(q.consent===true,'Explicit authorization consent is required.');
  s.approvals=s.approvals.map(x=>x.actor===a.id?{...x,valid:false}:x);s.approvals.push({id,actor:a.id,at,signature:q.signature,contentRevision:s.contentRevision,valid:true,consent:'I approve this demonstration revision and authorize the simulated filing. This is not an actual Form 8879 signature service.'});label='Client approved exact revision';detail={client:a.id,contentRevision:s.contentRevision};
 }else if(type==='file'){
  requireRole(['partner']);need(!['submitted','accepted'].includes(s.filing.status),'Already submitted');const bs=blockers(p,s);need(!bs.length,'Filing blocked: '+bs.join('; '));
  const snapshot={id:'snapshot-'+id,at,actor:a.id,branch:s.branch,revision:s.revision,contentRevision:s.contentRevision,packetFingerprint:ctx.packetHash||fingerprint(p),totals:totals(p,s),work:copy({...s,snapshots:[],audit:s.audit}),lines:effectiveLines(p,s)};
  snapshot.fingerprint=fingerprint(snapshot);s.snapshots.push(snapshot);s.filing.status='submitted';s.filing.submissions.push({id,at,actor:a.id,snapshot:snapshot.id,status:'submitted',federal:'submitted',california:'submitted',simulation:true});label='Simulated filing frozen in the vault';detail={snapshot:snapshot.id,fingerprint:snapshot.fingerprint};
 }else if(type==='filing_result'){
  requireRole(['partner']);need(s.filing.submissions.length,'No submission to update');need(['accepted','rejected'].includes(q.status),'Choose an outcome');need(s.filing.status==='submitted'||(s.filing.status==='accepted'&&q.status==='accepted'),'Only a submitted return can receive an outcome');
  const sub=s.filing.submissions.at(-1);const jurisdiction=q.jurisdiction||'federal';need(['federal','california'].includes(jurisdiction),'Unknown jurisdiction');sub[jurisdiction]=q.status;sub.resultNote=text(q.note,'Acknowledgment or rejection details');
  if(q.status==='rejected'){s.filing.status='rejected';sub.status='rejected';s.filing.readyRevision=null;s.approvals.forEach(x=>x.valid=false);}else if(sub.federal==='accepted'&&sub.california==='accepted'){s.filing.status='accepted';sub.status='accepted';}
  label='Simulated '+jurisdiction+' '+q.status;detail={submission:sub.id,status:q.status,note:q.note};
 }else if(type==='amend'){
  requireRole(['partner']);need(s.snapshots.length,'A frozen filing is required before an amendment.');need(s.filing.status==='accepted'||s.filing.status==='submitted','Current filing must be frozen.');s.branch='Amendment '+(s.snapshots.length);s.filing.status='amendment';s.filing.readyRevision=null;content=true;label='Amendment branch opened; filed snapshot unchanged';detail={reason:text(q.reason,'Amendment reason'),branch:s.branch};
 }else if(type==='replay'){
  requireRole(['preparer','reviewer','partner','firm_administrator']);const ev=p.timeline.find(t=>t.id===q.id);need(ev&&ev.at>s.asOf,'Select a later timeline event.');s.asOf=ev.at;content=true;label='Case clock advanced (not an approval or filing action)';detail={event:ev.id,asOf:ev.at};
 }else if(type==='standards'){
  requireRole(['firm_administrator']);need(Number.isFinite(q.percent)&&q.percent>=0&&q.percent<=1000,'Invalid percentage');need(Number.isFinite(q.amount)&&q.amount>=0,'Invalid amount');s.standards.variance_review.flag_if_change_over_percent=q.percent;s.standards.variance_review.and_over_amount=q.amount;content=true;label='Firm review thresholds updated';detail={percent:q.percent,amount:q.amount};
 }else if(type==='time'){
  requireRole(['preparer','reviewer','partner','quality_reviewer','firm_administrator']);need(areas.some(x=>x[0]===q.area)&&Number.isFinite(q.hours)&&q.hours>0&&q.hours<=24,'Choose an area and 0-24 hours');s.timeEntries.push({id,actor:a.id,at,area:q.area,hours:q.hours,note:text(q.note,'Time entry note')});label='Time logged';detail={area:q.area,hours:q.hours};
 }else if(type==='link'){
  requireRole(['preparer','reviewer','partner']);const refs=references([q.from,q.to]);s.links.push({id,actor:a.id,at,from:refs[0],to:refs[1],reason:text(q.reason,'Link rationale')});content=true;label='Evidence relationship created';detail={from:q.from,to:q.to};
 }else if(type==='attach'){
  requireRole(['preparer','reviewer','partner','client']);need(typeof q.name==='string'&&q.name.length<180,'Invalid file name');need(typeof q.data==='string'&&q.data.length<2800000&&/^[A-Za-z0-9+/]*={0,2}$/.test(q.data),'Attachment must be base64 and smaller than 2 MB');
  s.attachments.push({id:'attachment:'+id,at,actor:a.id,name:q.name.replace(/[^a-zA-Z0-9._ -]/g,'_'),mime:'application/octet-stream',target:q.target||null,note:text(q.note,'Attachment description'),data:q.data,clientVisible:!!q.clientVisible||a.role==='client'});content=true;label='Evidence attachment saved';detail={name:q.name,target:q.target};
 }else if(type==='carryforward'){
  requireRole(['preparer','reviewer','partner']);need(s.snapshots.length,'Create a frozen source record first.');s.carryforwards.push({id,at,actor:a.id,from:s.snapshots.at(-1).id,taxYear:2026,engineCarryovers:copy(indexes(p,s.currentVersion).v.carryovers_out),basis:copy(p.prior_years.basis_records),adjustments:copy(s.adjustments.filter(x=>!x.undone)),decisions:copy(s.decisions),notes:text(q.note,'Carryforward review note'),requiresReconciliation:s.adjustments.some(x=>!x.undone)});label='2026 handoff created with provenance';detail={source:s.snapshots.at(-1).id};
 }else if(type==='notice_response'){
  requireRole(['preparer','reviewer','partner','quality_reviewer']);if(q.notice){need(available(p,s,q.notice),'This notice has not arrived at the case clock.');need(resolveRef(p,q.notice).item!==undefined,'Unknown notice reference.');}s.noticeResponses.push({id,at,actor:a.id,notice:q.notice||null,text:text(q.text,'Response narrative'),refs:references(q.refs),snapshot:s.snapshots.at(-1)?.id||null});label='Notice response narrative saved';detail={notice:q.notice};
 }else if(type==='seen'){
  s.lastSeen[a.id]=s.revision;label='Review checkpoint saved';detail={seenRevision:s.revision};
 }else if(type==='reveal'){
  need(a.sensitive_data_clearance===true,'This actor does not have sensitive-data clearance.');label='Sensitive data viewed';detail={scope:q.scope||'session packet',reason:text(q.reason,'Access reason')};
 }else if(type==='export'){
  need(canInternal(a)||q.kind==='client','Clients can export only their client copy.');label='Record exported';detail={kind:q.kind||'review'};
 }else throw Error('Unsupported action: '+type);
 if(['adjust','undo'].includes(type)){for(const [target,v] of Object.entries(s.verification)){const now=effectiveLines(p,s).find(l=>l.key===target);if((now&&(now.stale||now.value!==v.value))||(!now&&value(p,s,target)!==v.value)){v.valid=false;v.invalidatedAt=at;v.invalidatedReason='Underlying evidence or calculation changed';}}}
 if(content){s.contentRevision++;s.filing.readyRevision=null;for(const x of s.signoffs)if(x.valid){x.valid=false;x.invalidatedAt=at;x.reason=label;}for(const x of s.approvals)if(x.valid){x.valid=false;x.invalidatedAt=at;} }
 s.revision++;s.audit.push({id,revision:s.revision,contentRevision:s.contentRevision,actor:a.id,name:a.name,role:a.role,at,type,label,detail,branch:s.branch});return s;
}
// Sensitive strings are masked in every string-bearing field, including narrative text.
function sensitiveTokens(p){const xs=new Set();for(const person of p.household.people)for(const k of ['ssn','ip_pin'])if(person[k])xs.add(String(person[k]));for(const e of p.extracted_values)if(['ssn','account_number'].includes(e.value_type)||/ip_pin|routing/i.test(e.field))if(e.value)xs.add(String(e.value));for(const v of Object.values(p.household.bank_account_for_refund_or_payment))if(/^\d+$/.test(v))xs.add(v);return [...xs].sort((a,b)=>b.length-a.length);}
function mask(p,obj){const tokens=sensitiveTokens(p);function walk(x,k=''){if(['ssn','ip_pin','account','routing','ero_pin','taxpayer_pin','spouse_pin'].includes(k)&&x!==null)return '[restricted]';if(typeof x==='string'){let t=x.replace(/\b\d{3}-\d{2}-\d{4}\b/g,'***-**-****').replace(/((?:taxpayer|spouse|ERO) PIN\s*[:=]?\s*)\d{5,6}/gi,'$1[restricted]').replace(/\bSE\d{2}(?:\s?\d{4}){5,6}\b/g,'[restricted account]');for(const n of tokens)t=t.split(n).join('[restricted]');return t;}if(Array.isArray(x))return x.map(v=>walk(v));if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).map(([key,v])=>[key,walk(v,key)]));return x;}return walk(obj);}
function publicView(p,s,a,reveal=false){
 let pp=copy(p),ss=copy(s);if(a.role==='client'){
  pp.firm={...pp.firm,firm_identity:{},budget_hours:{},staff:pp.firm.staff.map(x=>({id:x.id,name:x.name,role:x.role})),starter_standards:{verification_types:[],required_steps:[],variance_review:{}}};
  pp.prior_years.prior_preparer_workpaper={restricted:'Internal preparer workpaper'};
  pp.documents=pp.documents.filter(d=>!['D07','D69','D70','D72'].includes(d.id));
  pp.client.call_notes=[];pp.tax_agency_records={efile:[],notices:[]};
  ss.links=[];ss.carryforwards=[];ss.checklist={};ss.lastSeen={};ss.adjustments=ss.adjustments.map(x=>({id:x.id,actor:x.actor,at:x.at,branch:x.branch,version:x.version,undone:x.undone,effect:x.effect,patches:x.patches.map(t=>({target:t.target,value:t.value})),reason:'Internal review adjustment',refs:[]}));ss.notes=ss.notes.filter(n=>n.clientVisible);ss.decisions=[];ss.verification={};ss.signoffs=[];ss.audit=ss.audit.filter(e=>e.actor===a.id);ss.findingReviews={};ss.documentReviews={};ss.timeEntries=[];ss.snapshots=[];ss.attachments=ss.attachments.filter(x=>x.clientVisible);ss.standards={verification_types:[],required_steps:[],variance_review:{}};ss.noticeResponses=[];
 }
 if(!reveal||!a.sensitive_data_clearance){pp=mask(p,pp);ss=mask(p,ss);}
 return {packet:pp,state:ss,actor:a,actors:actors(p).map(x=>({id:x.id,name:x.name,role:x.role,sensitive_data_clearance:!!x.sensitive_data_clearance})),mode:'server'};
}
return {copy,round,sum,human,areas,areaName,areaOf,validatePacket,actors,actor,canPrepare,canReview,canInternal,initial,indexes,available,fingerprint,override,value,effectiveLines,effect,totals,descendants,evidence,resolveRef,inspect,variances,blockers,apply,mask,publicView};
});
