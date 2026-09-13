import { useState } from 'react';
import { saveUsageRates } from '../api';
import type { UsagePricing, UsageRate } from '../api';
export function UsageRates({pricing,onSaved}:{pricing:UsagePricing;onSaved:()=>void}) {
  const [currency,setCurrency]=useState(pricing.currency),[rates,setRates]=useState<UsageRate[]>(pricing.rates),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const patch=(index:number,value:Partial<UsageRate>)=>setRates(previous=>previous.map((row,i)=>i===index?{...row,...value}:row));
  return <details className="usage-section"><summary>Configure cost estimates</summary><p className="route-note">Enter provider prices per million tokens. Current rates apply to all retained history. Currency changes do not convert the numbers. A zero rate means no provider charge; hardware and electricity are excluded.</p>
    <form onSubmit={event=>{event.preventDefault();setBusy(true);setError('');void saveUsageRates({currency,rates}).then(onSaved).catch(e=>setError(String(e.message||e))).finally(()=>setBusy(false));}}>
      <label>Currency<input className="modal-input" aria-label="Pricing currency" required pattern="[A-Z]{3}" maxLength={3} value={currency} disabled={busy} onChange={event=>setCurrency(event.target.value.toUpperCase())} /></label>
      {rates.map((rate,index)=><fieldset className="usage-rate-row" key={index} disabled={busy}><legend>Model rate {index+1}</legend>
        <label>Model name<input className="modal-input" aria-label={`Model name ${index+1}`} required maxLength={200} value={rate.model} onChange={event=>patch(index,{model:event.target.value})} /></label>
        <label>Input / million<input className="modal-input" aria-label={`Input rate ${index+1}`} required type="number" min="0" max="100000" step="any" value={Number.isFinite(rate.inputPerMillion)?rate.inputPerMillion:''} onChange={event=>patch(index,{inputPerMillion:event.target.valueAsNumber})} /></label>
        <label>Output / million<input className="modal-input" aria-label={`Output rate ${index+1}`} required type="number" min="0" max="100000" step="any" value={Number.isFinite(rate.outputPerMillion)?rate.outputPerMillion:''} onChange={event=>patch(index,{outputPerMillion:event.target.valueAsNumber})} /></label>
        <button className="popup-tab" type="button" onClick={()=>setRates(previous=>previous.filter((_,i)=>i!==index))}>Remove rate {index+1}</button>
      </fieldset>)}
      {error&&<p className="route-note" role="alert">{error}</p>}
      <button className="btn btn-secondary" type="button" disabled={busy||rates.length>=200} onClick={()=>setRates(previous=>[...previous,{model:'',inputPerMillion:0,outputPerMillion:0}])}>Add model rate</button>{' '}
      <button className="btn btn-secondary" type="submit" disabled={busy}>{busy?'Saving…':'Save rates'}</button>
    </form>
  </details>;
}
