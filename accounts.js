/* Everything App v1.5A — opt-in, two-account cloud workspace.
   Public frontend holds ONLY a publishable Supabase key. Authorization is in SQL RLS.
   Legacy local favorites/routes are never erased or silently uploaded. */
(() => {
  "use strict";
  const CONFIG_KEY = "everything.cloud.connection.v1";
  const LOCAL_BACKUP = "everything.cloud.legacyBackup.v1";
  const AUTO_MODE = "everything.cloud.mode.v1";
  const own = id => document.getElementById(id);
  const state = { client:null, user:null, member:null, active:false, rows:[], versions:[],
    synced:new Map(), dirty:false, saving:false, timer:null, realtime:null, lastError:"",
    lastDelete:null, lastVersion:null, selection:null };
  const html = value => String(value ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const config = () => { try { return JSON.parse(localStorage.getItem(CONFIG_KEY)||"null"); } catch { return null; } };
  const hasMap = () => typeof map !== "undefined" && !!map;
  const getOwnCollection = () => state.member?.handle || "kagan";
  const entryKey = (kind, clientId, author) => `${kind}::${author}::${clientId}`;
  const clean = x => Object.fromEntries(Object.entries(x || {}).filter(([key]) => !key.startsWith("__")));
  const errText = error => error?.message || String(error || "Unknown problem");
  function isPublishableKey(key){
    if(key.startsWith("sb_publishable_"))return true;
    if(!key.startsWith("eyJ"))return false;
    try {
      const part=key.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
      const claims=JSON.parse(atob(part));
      return claims.role==="anon"; // Explicitly reject legacy service_role JWTs.
    } catch {return false;}
  }
  function status(text, bad=false){const n=own("account-status");if(n){n.textContent=text;n.classList.toggle("account-error",bad);}state.lastError=bad?text:"";}
  function refreshUI(){
    const configured=!!config(), paired=!!state.member, signed=!!state.user;
    own("account-configuration")?.classList.toggle("hidden",configured);
    own("account-sign-in")?.classList.toggle("hidden",!configured||signed);
    own("account-workspace")?.classList.toggle("hidden",!paired);
    own("account-pending")?.classList.toggle("hidden",!signed||paired);
    const who=own("account-identity");if(who)who.textContent=paired?`Signed in as ${state.member.handle === "ela"?"Ela":"Kağan"} · ${state.user.email}`:signed?`Signed in: ${state.user.email}`:"Not signed in";
    const mode=own("account-mode");if(mode)mode.textContent=state.active?"Cloud workspace active — syncing enabled":"Local map active — cloud data not loaded into map";
    own("account-cloud-activate")?.classList.toggle("hidden",state.active);
    own("account-cloud-local")?.classList.toggle("hidden",!state.active);
    own("account-signout")?.classList.toggle("hidden",!signed);
    const select=own("account-new-collection");if(select && paired){
      const personal=select.querySelector('option[data-own="1"]');if(personal){personal.value=getOwnCollection();personal.textContent=getOwnCollection()==="ela"?"Ela's collection":"Kağan's collection";}
    }
    const itemScope=own("account-place-collection");
    own("account-place-scope-wrap")?.classList.toggle("hidden",!paired);
    if(itemScope&&paired){
      const ownOption=itemScope.querySelector('option[data-own="1"]');if(ownOption){ownOption.value=getOwnCollection();ownOption.textContent=getOwnCollection()==="ela"?"Ela's favorites":"Kağan's favorites";}
    }
    renderEntries();
  }
  async function library(){
    // Only invoked when the user chooses to connect. Never put a service-role key here.
    const module = await import("https://esm.sh/@supabase/supabase-js@2");
    return module.createClient;
  }
  async function connect(saved=config()){
    if(!saved?.url || !saved?.key) return;
    if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(saved.url)) throw new Error("Use your HTTPS Supabase project URL.");
    if(!isPublishableKey(saved.key)) throw new Error("Use ONLY the publishable key (or legacy anon key), not secret/service_role.");
    status("Connecting securely…");
    const createClient=await library();
    if(state.client && state.realtime){await state.client.removeChannel(state.realtime);state.realtime=null;}
    state.client=createClient(saved.url.replace(/\/$/,""),saved.key,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
    });
    const {data,error}=await state.client.auth.getSession();if(error)throw error;
    await setSession(data.session);
    state.client.auth.onAuthStateChange((event,session)=>{
      // Avoid awaiting Supabase calls inside auth callback (can deadlock SDK).
      setTimeout(()=>setSession(session).catch(e=>status(errText(e),true)),0);
    });
    status(state.member?"Connected. You can import old data or activate your cloud workspace.":"Connected. Sign in with your invited account.");
    refreshUI();
  }
  async function setSession(session){
    const before=state.user?.id || null;
    state.user=session?.user || null;
    if(!state.user){
      state.member=null;
      if(state.active)restoreLocal();
      state.rows=[];state.versions=[];state.synced.clear();
      refreshUI();return;
    }
    if(before && before!==state.user.id && state.active)restoreLocal();
    const {data,error}=await state.client.from("everything_members").select("user_id,handle").eq("user_id",state.user.id).maybeSingle();
    if(error){state.member=null;status(`Account connected, but membership lookup failed: ${errText(error)}`,true);refreshUI();return;}
    state.member=data||null;
    if(!data){status("You're signed in, but the two accounts have not been paired in Supabase yet. Complete PAIR_ACCOUNTS.sql, then tap Refresh membership.");refreshUI();return;}
    if(localStorage.getItem(AUTO_MODE)===state.user.id && !state.active) await activateCloud(true);
    else if(!state.active) await fetchRows();
    refreshUI();
  }
  async function fetchRows(){
    if(!state.client||!state.member)return [];
    const {data,error}=await state.client.from("everything_entries").select("*").order("updated_at",{ascending:false}).limit(2000);
    if(error)throw error;
    state.rows=data||[];
    renderEntries();
    return state.rows;
  }
  function ensureBackup(){
    if(localStorage.getItem(LOCAL_BACKUP))return;
    const backup={time:new Date().toISOString(),places:JSON.parse(localStorage.getItem(FREQUENT_PLACES_STORAGE)||"[]"),
      routes:JSON.parse(localStorage.getItem(FAVORITE_ROUTES_STORAGE)||"[]")};
    localStorage.setItem(LOCAL_BACKUP,JSON.stringify(backup));
  }
  function download(object,filename){
    const blob=new Blob([JSON.stringify(object,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function exportLocal(){
    const local={exportedAt:new Date().toISOString(),version:"1.5A",places:JSON.parse(localStorage.getItem(FREQUENT_PLACES_STORAGE)||"[]"),routes:JSON.parse(localStorage.getItem(FAVORITE_ROUTES_STORAGE)||"[]")};
    download(local,"everything-local-backup.json");status("Local backup downloaded. Keep it in a private folder.");
  }
  async function exportCloud(){
    if(!state.member)return status("Sign in first.",true);
    await fetchRows();
    const {data,error}=await state.client.from("everything_versions").select("*").order("captured_at",{ascending:false}).limit(5000);
    if(error)throw error;
    download({exportedAt:new Date().toISOString(),account:state.member.handle,entries:state.rows,versions:data||[]},"everything-cloud-backup.json");
    status("Your accessible cloud records and versions are exported. Store them privately.");
  }
  function useRows(){
    const active=state.rows.filter(row=>!row.deleted_at);
    const mapped=(kind)=>active.filter(row=>row.kind===kind).map(row=>({
      ...row.payload, id:row.client_id,
      __cloudRowId:row.id,__cloudAuthor:row.author_id,__cloudCollection:row.collection,__cloudVisibility:row.visibility
    }));
    frequentPlaces=mapped("place").filter(validSavedPlace);
    favoriteRoutes=mapped("route").filter(route=>route.id&&route.name&&Array.isArray(route.segments));
    state.synced=new Map(state.rows.map(row=>[entryKey(row.kind,row.client_id,row.author_id),row]));
    if(hasMap()){
      createPlaceMarkers();applyLayerState();
      applyFavoriteCategoryVisibility?.();
    }
    renderFavoritesSheet();refreshSearchIfOpen();
  }
  async function activateCloud(fromStored=false){
    if(!state.member)return status("Sign in and finish pairing both accounts first.",true);
    if(state.dirty)return status("Wait for pending changes before switching.",true);
    ensureBackup();
    if(!fromStored && !window.confirm("Switch this map to your cloud workspace? Your previous device favorites remain backed up and will NOT be uploaded unless you choose Import local data."))return;
    status("Loading shared data…");await fetchRows();
    state.active=true;localStorage.setItem(AUTO_MODE,state.user.id);useRows();refreshUI();
    status("Cloud workspace active. Changes to your own favorites and routes sync automatically; tap Refresh on the other device.");
    watchChanges();
  }
  function restoreLocal(){
    state.active=false;state.dirty=false;clearTimeout(state.timer);
    localStorage.removeItem(AUTO_MODE);
    frequentPlaces=loadFrequentPlaces();favoriteRoutes=loadFavoriteRoutes();
    if(hasMap()){createPlaceMarkers();applyLayerState();}
    renderFavoritesSheet();refreshSearchIfOpen();refreshUI();
  }
  async function importLocal(){
    if(!state.member)return status("Sign in and pair both accounts first.",true);
    ensureBackup();exportLocal();
    const places=JSON.parse(localStorage.getItem(FREQUENT_PLACES_STORAGE)||"[]");
    const routes=JSON.parse(localStorage.getItem(FAVORITE_ROUTES_STORAGE)||"[]");
    if(!window.confirm(`Import ${places.length} locally saved places and ${routes.length} local routes into ${getOwnCollection()}'s cloud collection? Your device copy stays unchanged. Repeating Import will not create duplicates.`))return;
    const rows=[...places.filter(validSavedPlace).map(x=>({kind:"place",value:x})),...routes.filter(x=>x?.id&&x.name&&Array.isArray(x.segments)).map(x=>({kind:"route",value:x}))];
    const handle=getOwnCollection();status(`Importing ${rows.length} items…`);
    for(let i=0;i<rows.length;i+=40){
      const batch=rows.slice(i,i+40).map(({kind,value})=>{
        const item={...clean(value),id:`${handle}-legacy-${value.id}`,originalId:value.id};
        const city=kind==="place"?getPlaceCityId(value):getRouteCityId(value);
        return {author_id:state.user.id,kind,client_id:item.id,collection:handle,visibility:"shared",city,payload:item,deleted_at:null};
      });
      const {error}=await state.client.from("everything_entries").upsert(batch,{onConflict:"author_id,kind,client_id"});
      if(error){status(`Import stopped after ${i} items: ${errText(error)}. Your local data is safe; fix the issue and retry.`,true);return;}
    }
    await fetchRows();if(!state.active){state.active=true;localStorage.setItem(AUTO_MODE,state.user.id);watchChanges();}useRows();refreshUI();
    status(`Imported ${rows.length} existing items. Your original local data and backup remain untouched.`);
  }
  function queueSave(){
    if(!state.active||!state.member)return;
    state.dirty=true;clearTimeout(state.timer);
    state.timer=setTimeout(()=>flush().catch(error=>status(`Sync failed; data stays in this open tab. Do not close it yet. ${errText(error)}`,true)),650);
  }
  async function flush(){
    if(!state.active||!state.member||state.saving)return;
    state.saving=true;clearTimeout(state.timer);
    try{
      const ownRows=state.rows.filter(row=>row.author_id===state.user.id&&(row.kind==="place"||row.kind==="route"));
      const items=[...frequentPlaces.map(item=>({kind:"place",item})),...favoriteRoutes.map(item=>({kind:"route",item}))];
      const seen=new Set();
      for(const {kind,item} of items){
        if(item.__cloudAuthor && item.__cloudAuthor!==state.user.id)continue;
        const key=entryKey(kind,item.id,state.user.id);seen.add(key);
        const previous=state.synced.get(key);
        const payload=clean(item);
        const requested=item.__cloudCollection||getOwnCollection();
        const collection=(requested===getOwnCollection()||requested==="together")?requested:getOwnCollection();
        const city=kind==="place"?getPlaceCityId(item):getRouteCityId(item);
        if(previous && !previous.deleted_at && JSON.stringify(previous.payload)===JSON.stringify(payload) && previous.collection===collection && previous.city===city)continue;
        const record={author_id:state.user.id,kind,client_id:item.id,collection,visibility:"shared",city,payload,deleted_at:null};
        const {data,error}=await state.client.from("everything_entries").upsert(record,{onConflict:"author_id,kind,client_id"}).select("*").single();
        if(error)throw error;
        state.synced.set(key,data);
        const idx=state.rows.findIndex(x=>x.id===data.id);if(idx<0)state.rows.push(data);else state.rows[idx]=data;
        item.__cloudAuthor=state.user.id;item.__cloudRowId=data.id;item.__cloudCollection=collection;
      }
      for(const row of ownRows){
        if(row.deleted_at || seen.has(entryKey(row.kind,row.client_id,row.author_id)))continue;
        const {data,error}=await state.client.from("everything_entries").update({deleted_at:new Date().toISOString()}).eq("id",row.id).select("*").single();
        if(error)throw error;
        state.lastDelete=data.id;
        state.synced.set(entryKey(row.kind,row.client_id,row.author_id),data);
        const idx=state.rows.findIndex(x=>x.id===data.id);if(idx>=0)state.rows[idx]=data;
      }
      state.dirty=false;status("Cloud changes saved ✓");renderEntries();
    } finally {state.saving=false;}
  }
  async function refreshCloud(){
    if(!state.member)return status("Sign in first.",true);
    if(state.dirty){await flush();if(state.dirty)return;}
    status("Refreshing from cloud…");await fetchRows();if(state.active)useRows();
    status("Up to date with cloud.");
  }
  function watchChanges(){
    if(!state.client||state.realtime)return;
    state.realtime=state.client.channel("everything-entries-changes").on("postgres_changes",{
      event:"*",schema:"public",table:"everything_entries"
    },()=>{
      if(state.active&&!state.dirty&&!state.saving){clearTimeout(state.timer);state.timer=setTimeout(()=>refreshCloud().catch(console.warn),450);}
    }).subscribe();
  }
  async function signIn(){
    if(!state.client)return status("Connect Supabase first.",true);
    const email=own("account-email").value.trim(),password=own("account-password").value;
    if(!email||!password)return status("Enter your invited email and password.",true);
    status("Signing in…");const {data,error}=await state.client.auth.signInWithPassword({email,password});
    own("account-password").value="";if(error)throw error;
    await setSession(data.session);status("Signed in. Your welcome-screen profile is visual; account permissions come from this login.");
  }
  async function updatePassword(){
    if(!state.user)return status("Open your invitation email or sign in first.",true);
    const pass=own("account-new-password").value;if(pass.length<12)return status("Use a password of at least 12 characters.",true);
    const {error}=await state.client.auth.updateUser({password:pass});own("account-new-password").value="";
    if(error)throw error;status("Password updated.");
  }
  async function signOut(){
    if(state.dirty){await flush();if(state.dirty)return status("Changes failed to sync. Keep this tab open and retry before signing out.",true);}
    if(state.realtime){await state.client.removeChannel(state.realtime);state.realtime=null;}
    if(state.active)restoreLocal();
    const {error}=await state.client.auth.signOut();if(error)throw error;
    state.user=null;state.member=null;state.rows=[];state.versions=[];state.synced.clear();refreshUI();status("Signed out. Your original device data is still available locally.");
  }
  async function addNote(){
    if(!state.member)return status("Sign in first.",true);
    const title=own("account-note-place").value.trim(),body=own("account-note-text").value.trim();
    if(!title||!body)return status("Give your note a place and a message.",true);
    const visibility=own("account-note-visibility").value;
    const centre=state.selection?.coords||(hasMap()?{lat:map.getCenter().lat(),lng:map.getCenter().lng()}:CITY_CONFIG[currentCityId].center);
    const record={author_id:state.user.id,kind:"note",client_id:crypto.randomUUID(),
      collection:visibility==="private"?getOwnCollection():"together",visibility,
      city:currentCityId,payload:{title,text:body,coords:centre,createdAt:Date.now()},deleted_at:null};
    const {error}=await state.client.from("everything_entries").insert(record);if(error)throw error;
    own("account-note-text").value="";await refreshCloud();status(visibility==="shared"?"Shared note saved for both of you.":"Private note saved for your account only.");
  }
  async function updateNote(id){
    const row=state.rows.find(x=>x.id===id);if(!row)return;
    const value=window.prompt("Edit note",row.payload.text||"");if(value===null)return;
    const {error}=await state.client.from("everything_entries").update({payload:{...row.payload,text:value}}).eq("id",id);
    if(error)throw error;await refreshCloud();
  }
  async function softDelete(id){
    const row=state.rows.find(x=>x.id===id);if(!row)return;
    if(!window.confirm(`Move "${row.payload.name||row.payload.title||row.client_id}" to Trash? You can restore it.`))return;
    const {error}=await state.client.from("everything_entries").update({deleted_at:new Date().toISOString()}).eq("id",id);
    if(error)throw error;state.lastDelete=id;await refreshCloud();status("Moved to Trash. Undo is available.");
  }
  async function restore(id){
    const {error}=await state.client.from("everything_entries").update({deleted_at:null}).eq("id",id);
    if(error)throw error;state.lastDelete=null;await refreshCloud();status("Restored from Trash.");
  }
  async function versions(id){
    const {data,error}=await state.client.from("everything_versions").select("*").eq("entry_id",id).order("captured_at",{ascending:false}).limit(30);
    if(error)throw error;
    const node=own("account-history-list");
    node.innerHTML=data.length?data.map(v=>`<div class="account-list-item"><div><b>${html(new Date(v.captured_at).toLocaleString())}</b><small>${html(v.payload.name||v.payload.title||v.kind)}</small></div><button data-restore-version="${html(v.version_id)}">Restore version</button></div>`).join(""):'No earlier versions yet.';
    node.querySelectorAll("[data-restore-version]").forEach(btn=>btn.addEventListener("click",()=>guard(async()=>{
      const v=data.find(x=>String(x.version_id)===btn.dataset.restoreVersion);if(!v)return;
      if(!confirm("Restore this earlier version? The current version will be preserved in history."))return;
      const current=state.rows.find(row=>row.id===id);
      const change=current?.author_id===state.user.id
        ? {payload:v.payload,deleted_at:v.deleted_at,collection:v.collection,visibility:v.visibility,city:v.city}
        : {payload:v.payload}; // Collaborators can edit shared note text, never change ownership/metadata.
      const {error}=await state.client.from("everything_entries").update(change).eq("id",id);
      if(error)throw error;await refreshCloud();status("Earlier version restored.");
    })));
  }
  function renderEntries(){
    const node=own("account-entry-list"),notes=own("account-notes-list"),trash=own("account-trash-list");
    if(!node||!notes||!trash)return;
    const handle=state.member?.handle||"";
    const active=state.rows.filter(row=>!row.deleted_at);
    node.innerHTML=active.filter(x=>x.kind!=="note").map(row=>{
      const mine=row.author_id===state.user?.id;
      const label=row.collection==="together"?"Together":row.collection==="ela"?"Ela":"Kağan";
      return `<div class="account-list-item"><div><b>${html(row.payload.name||"Untitled")}</b><small>${html(label)} · ${html(row.city)} · ${html(row.kind)} ${mine?"· Mine":"· Partner's"}</small></div><div class="account-row-actions">${mine?`<button data-collection="${html(row.id)}">${row.collection==="together"?"Move to mine":"Move to Together"}</button><button data-trash="${html(row.id)}">Delete</button><button data-history="${html(row.id)}">History</button>`:"<span class='account-readonly'>View only</span>"}</div></div>`;
    }).join("") || '<p class="account-help">No cloud favorites yet. Import your existing favorites or add a new place after activating Cloud.</p>';
    notes.innerHTML=active.filter(x=>x.kind==="note"&&x.payload?.type!=="travel_plan").map(row=>{
      const mine=row.author_id===state.user?.id;const editable=mine||row.visibility==="shared";
      return `<div class="account-list-item"><div><b>${html(row.payload.title)}</b><small>${html(row.city)} · ${row.visibility==="private"?"Only me":"Shared"} · ${html(row.author_id===state.user?.id?handle:"Partner")}</small><p>${html(row.payload.text)}</p></div><div class="account-row-actions">${editable?`<button data-edit-note="${html(row.id)}">Edit</button>`:""}${mine||row.visibility==="shared"?`<button data-trash="${html(row.id)}">Trash</button>`:""}<button data-history="${html(row.id)}">History</button></div></div>`;
    }).join("")||'<p class="account-help">No cloud notes yet.</p>';
    trash.innerHTML=state.rows.filter(x=>x.deleted_at&&x.payload?.type!=="travel_plan").map(row=>`<div class="account-list-item"><div><b>${html(row.payload.name||row.payload.title||"Item")}</b><small>${html(row.kind)} · ${html(row.deleted_at)}</small></div><button data-restore="${html(row.id)}">Restore</button></div>`).join("")||'<p class="account-help">Trash is empty.</p>';
    for(const panel of [node,notes,trash]){
      panel.querySelectorAll("[data-trash]").forEach(b=>b.addEventListener("click",()=>guard(()=>softDelete(b.dataset.trash))));
      panel.querySelectorAll("[data-history]").forEach(b=>b.addEventListener("click",()=>guard(()=>versions(b.dataset.history))));
      panel.querySelectorAll("[data-restore]").forEach(b=>b.addEventListener("click",()=>guard(()=>restore(b.dataset.restore))));
    }
    node.querySelectorAll("[data-collection]").forEach(b=>b.addEventListener("click",()=>guard(async()=>{
      const row=state.rows.find(x=>x.id===b.dataset.collection);if(!row)return;
      const collection=row.collection==="together"?getOwnCollection():"together";
      const {error}=await state.client.from("everything_entries").update({collection}).eq("id",row.id);if(error)throw error;
      await refreshCloud();
    })));
    notes.querySelectorAll("[data-edit-note]").forEach(b=>b.addEventListener("click",()=>guard(()=>updateNote(b.dataset.editNote))));
  }
  function selectedForNote(title,coords){state.selection={title,coords};own("account-note-place").value=title||"";}
  function injectNotesAction(title,coords){
    if(!state.member||!title||!own("detail-content"))return;
    const content=own("detail-content");if(content.querySelector("#account-place-note"))return;
    const actions=content.querySelector(".detail-actions")||content;
    const button=document.createElement("button");button.id="account-place-note";button.className="secondary-btn compact-btn";button.textContent="Add note";
    button.addEventListener("click",()=>{selectedForNote(title,coords);own("account-modal").classList.remove("hidden");own("account-note-text").focus();});
    actions.appendChild(button);
    // Show shared/personal notes in the same info-panel style as other place details.
    const matched=state.rows.filter(row=>row.kind==="note"&&row.payload?.type!=="travel_plan"&&!row.deleted_at&&(
      String(row.payload.title||"").trim().toLowerCase()===String(title).trim().toLowerCase()
      || (coords && row.payload.coords && Math.abs(Number(row.payload.coords.lat)-Number(coords.lat))<0.00035
         && Math.abs(Number(row.payload.coords.lng)-Number(coords.lng))<0.00035)
    ));
    if(matched.length){
      const section=document.createElement("div");section.className="detail-section account-place-notes";
      const heading=document.createElement("div");heading.className="info-section-title";heading.textContent="OUR NOTES";section.appendChild(heading);
      for(const note of matched){
        const text=document.createElement("p");text.className="account-note-preview";
        text.textContent=`${note.visibility==="private"?"🔒 Private":"❤️ Shared"} · ${note.payload.text||""}`;
        section.appendChild(text);
      }
      actions.before(section);
    }
  }
  function attach(){
    // Runtime wrappers preserve all existing v1.5.Fixed features and buttons.
    const oldSavePlaces=saveFrequentPlaces,oldSaveRoutes=saveFavoriteRoutes;
    saveFrequentPlaces=function(){if(state.active)queueSave();else oldSavePlaces();};
    saveFavoriteRoutes=function(){if(state.active)queueSave();else oldSaveRoutes();};
    const oldPlace=showPlaceInfo;
    showPlaceInfo=function(place){const result=oldPlace(place);injectNotesAction(place.name,{lat:place.lat,lng:place.lng});
      const badge=own("detail-content")?.querySelector(".detail-label");if(badge&&place.__cloudCollection)badge.textContent+=` · ${place.__cloudCollection==="together"?"TOGETHER":place.__cloudCollection==="ela"?"ELA":"KAĞAN"}`;
      const owner=place.__cloudAuthor;if(state.active&&owner&&owner!==state.user?.id){
        own("edit-place-btn")?.remove();own("delete-place-btn")?.remove();
      }
      return result;};
    const oldPoi=v14d1PoiPanel;
    v14d1PoiPanel=function(props){const result=oldPoi(props);injectNotesAction(props.name,props.loc);return result;};
    const oldOpenEditor=openPlaceEditor;
    openPlaceEditor=function(...args){const result=oldOpenEditor(...args);const selector=own("account-place-collection");if(selector)selector.value=own("account-new-collection")?.value||getOwnCollection();return result;};
    const oldEdit=openPlaceEditorForEdit;
    openPlaceEditorForEdit=function(place){if(state.active&&place.__cloudAuthor&&place.__cloudAuthor!==state.user.id){status("Only the creator can edit this favorite. You can add a copy to your own collection.",true);return;}
      const result=oldEdit(place),scope=own("account-place-collection");if(scope)scope.value=place.__cloudCollection||getOwnCollection();return result;};
    const oldSaveFromEditor=savePlaceFromEditor;
    savePlaceFromEditor=function(){const scope=own("account-place-collection")?.value;
      const beforeIds=new Set(frequentPlaces.map(p=>p.id));const editedId=editingFrequentPlaceId;
      const result=oldSaveFromEditor();
      if(state.active){const target=editedId?frequentPlaces.find(p=>p.id===editedId):frequentPlaces.find(p=>!beforeIds.has(p.id));
        if(target){target.__cloudCollection=scope==="together"?"together":getOwnCollection();queueSave();}
      }return result;};
    const oldDelete=deleteFrequentPlace;
    deleteFrequentPlace=function(id){const place=frequentPlaces.find(p=>p.id===id);if(state.active&&place?.__cloudAuthor&&place.__cloudAuthor!==state.user.id){status("You can view this favorite, but only its creator can delete it.",true);return;}return oldDelete(id);};
    const oldDeleteRoute=deleteFavoriteRoute;
    deleteFavoriteRoute=function(id){const route=favoriteRoutes.find(r=>r.id===id);if(state.active&&route?.__cloudAuthor&&route.__cloudAuthor!==state.user.id){status("Only its creator can delete this favorite route.",true);return;}return oldDeleteRoute(id);};
  }
  async function guard(fn){try{await fn();}catch(e){console.error("Everything account operation failed",e);status(errText(e),true);}}
  own("accounts-btn")?.addEventListener("click",()=>{own("settings-modal")?.classList.add("hidden");own("account-modal")?.classList.remove("hidden");refreshUI();});
  own("account-close")?.addEventListener("click",()=>own("account-modal").classList.add("hidden"));
  own("account-connect")?.addEventListener("click",()=>guard(async()=>{
    const url=own("account-project-url").value.trim(),key=own("account-public-key").value.trim();
    if(!isPublishableKey(key))throw new Error("Publishable/anon key only. NEVER enter a secret or service_role key.");
    localStorage.setItem(CONFIG_KEY,JSON.stringify({url,key}));own("account-public-key").value="";await connect();
  }));
  own("account-signin-btn")?.addEventListener("click",()=>guard(signIn));
  own("account-update-password")?.addEventListener("click",()=>guard(updatePassword));
  own("account-signout")?.addEventListener("click",()=>guard(signOut));
  own("account-refresh-member")?.addEventListener("click",()=>guard(async()=>{const {data}=await state.client.auth.getSession();await setSession(data.session);}));
  own("account-import")?.addEventListener("click",()=>guard(importLocal));
  own("account-cloud-activate")?.addEventListener("click",()=>guard(()=>activateCloud(false)));
  own("account-cloud-local")?.addEventListener("click",()=>{if(state.dirty)return status("Wait for changes to sync before leaving cloud mode.",true);restoreLocal();status("Returned to your original device data.");});
  own("account-refresh")?.addEventListener("click",()=>guard(refreshCloud));
  own("account-download-local")?.addEventListener("click",()=>guard(exportLocal));
  own("account-download-cloud")?.addEventListener("click",()=>guard(exportCloud));
  own("account-note-save")?.addEventListener("click",()=>guard(addNote));
  own("account-undo")?.addEventListener("click",()=>guard(async()=>{if(!state.lastDelete)return status("No recent deletion to undo. Check Trash below.");await restore(state.lastDelete);}));
  own("account-retry-sync")?.addEventListener("click",()=>guard(flush));
  own("account-open-setup")?.addEventListener("click",()=>{own("account-configuration").classList.remove("hidden");});
  own("account-new-collection")?.addEventListener("change",event=>{if(own("account-place-collection"))own("account-place-collection").value=event.target.value;});
  own("account-place-collection")?.addEventListener("change",event=>{if(event.target.value!=="together"&&event.target.value!==getOwnCollection())event.target.value=getOwnCollection();});
  window.addEventListener("online",()=>{if(state.dirty)guard(flush);});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden&&state.active&&!state.dirty)guard(refreshCloud);});
  // v1.5F: narrowly scoped travel-plan adapter over EXISTING RLS-protected note records.
  // No new SQL, client/service keys, extra privileges or cross-account private reads.
  window.EverythingTripCloud=Object.freeze({
    identity:()=>state.member&&state.user?state.user.id:null,
    ready:()=>Boolean(state.client&&state.user&&state.member),
    async list(){
      if(!state.client||!state.member||!state.user)throw Error("Sign in and pair your account to sync trips.");
      const {data,error}=await state.client.from("everything_entries")
        .select("id,author_id,client_id,collection,visibility,city,payload,updated_at,deleted_at")
        .eq("kind","note").limit(1000);
      if(error)throw error;
      return (data||[]).filter(x=>x.payload?.type==="travel_plan"&&!x.deleted_at);
    },
    async save(trip,previous){
      if(!state.client||!state.member||!state.user)throw Error("Sign in and pair accounts before cloud syncing.");
      if(!trip?.id||String(trip.id).length>85)throw Error("Invalid trip identifier.");
      const payload={type:"travel_plan",title:String(trip.name||"Trip").slice(0,100),trip};
      if(JSON.stringify(payload).length>110000)throw Error("Trip too large to sync. Keep sensitive documents outside the planner.");
      if(previous){
        if(previous.visibility!=="shared"&&previous.author_id!==state.user.id)throw Error("This trip is private to its author.");
        if(previous.author_id!==state.user.id&&previous.collection!=="together")throw Error("Partner edits are allowed only on shared Together trips.");
        if((previous.collection==="together")!==(trip.sharing==="together"))throw Error("Changing an existing trip’s sharing is not supported. Export and create a new trip instead.");
        const {data,error}=await state.client.from("everything_entries")
           .update({payload}).eq("id",previous.id).eq("updated_at",previous.updated_at).select("id,author_id,client_id,collection,visibility,city,payload,updated_at,deleted_at").maybeSingle();
        if(error)throw error;if(!data)throw Error("This trip changed on another device. Reload before saving; your local draft is preserved.");
        return data;
      }
      const {data,error}=await state.client.from("everything_entries").insert({
        author_id:state.user.id,kind:"note",client_id:"travel-"+trip.id,
        collection:trip.sharing==="together"?"together":state.member.handle,
        visibility:trip.sharing==="together"?"shared":"private",city:trip.city,payload,deleted_at:null
      }).select("id,author_id,client_id,collection,visibility,city,payload,updated_at,deleted_at").single();
      if(error)throw error;return data;
    },
    async remove(previous){
      if(!state.client||!state.member||!state.user)throw Error("Sign in first.");
      if(!previous||previous.author_id!==state.user.id)throw Error("Only the creator can delete this trip.");
      const {data,error}=await state.client.from("everything_entries")
       .update({deleted_at:new Date().toISOString()}).eq("id",previous.id).eq("updated_at",previous.updated_at).select("id").maybeSingle();
      if(error)throw error;if(!data)throw Error("Trip was changed elsewhere; reload first.");return true;
    }
  });
  attach();refreshUI();
  if(config())guard(()=>connect());
  console.info("Everything App 1.5A cloud accounts module loaded (opt-in; local data preserved)");
})();
