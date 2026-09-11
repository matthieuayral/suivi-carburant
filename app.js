import { PublicClientApplication } from "https://cdn.jsdelivr.net/npm/@azure/msal-browser@5/+esm";
import { CONFIG } from "./config.js";
const $=id=>document.getElementById(id);
const msal = new PublicClientApplication({auth:{clientId:CONFIG.clientId,authority:`https://login.microsoftonline.com/${CONFIG.tenantId}`,redirectUri:CONFIG.redirectUri},cache:{cacheLocation:"localStorage"}});
await msal.initialize();

// Use one interaction model only: full-page redirect. This is more robust for a static PWA
// and does not require the dedicated popup redirect bridge introduced by MSAL Browser v5.
let redirectResult=null;
try {
  redirectResult=await msal.handleRedirectPromise();
} catch(e) {
  console.error("MSAL redirect",e);
}

const now=new Date(); $("date").value=now.toISOString().slice(0,10); $("heure").value=now.toTimeString().slice(0,5);
let account=redirectResult?.account || msal.getActiveAccount() || msal.getAllAccounts()[0] || null;
if(account) msal.setActiveAccount(account);
render();

$("login").onclick=async()=>{
  try{
    await msal.loginRedirect({scopes:["User.Read","Files.ReadWrite"],redirectUri:CONFIG.redirectUri});
  }catch(e){
    console.error("MSAL login",e);
    $("who").textContent="Connexion échouée : "+(e.errorCode||e.message||e);
  }
};
function render(){ $("who").textContent=account?`Connecté : ${account.username}`:"Non connecté"; }
async function token(){
  if(!account) throw new Error("Connecte-toi d'abord à Microsoft.");
  try{return (await msal.acquireTokenSilent({account,scopes:["Files.ReadWrite"]})).accessToken}
  catch(e){
    console.error("Token silencieux",e);
    throw new Error("La session Microsoft doit être renouvelée. Clique sur Connexion Microsoft puis réessaie.");
  }
}
async function graph(url,opt={}){const t=await token();const r=await fetch("https://graph.microsoft.com/v1.0"+url,{...opt,headers:{Authorization:`Bearer ${t}`,...(opt.headers||{})}});if(!r.ok) throw new Error(`${r.status} ${await r.text()}`);return r.status===204?null:r.json();}
const encPath=p=>p.split("/").map(encodeURIComponent).join("/");
async function uploadTicket(file,date,km){if(!file)return "";const ext=(file.name.split(".").pop()||"jpg").replace(/[^a-z0-9]/gi,"");const name=`${date}_${km}_${Date.now()}.${ext}`;const path=`${CONFIG.ticketsFolder}/${name}`;await graph(`/me/drive/root:${encPath(path)}:/content`,{method:"PUT",headers:{"Content-Type":file.type||"application/octet-stream"},body:file});return path;}
$("form").onsubmit=async e=>{e.preventDefault();$("status").textContent="Enregistrement…";try{const km=Number($("km").value),litres=Number($("litres").value),montant=Number($("montant").value);if(!(km>0&&litres>0&&montant>0))throw new Error("Km, litres et montant sont obligatoires.");const ticketPath=await uploadTicket($("ticket").files[0],$("date").value,km);const values=[["",$("date").value,$("heure").value,km,litres,montant,$("carburant").value,$("station").value.trim(),$("ville").value.trim(),$("prixProx").value?Number($("prixProx").value):"",ticketPath,$("commentaire").value.trim(),"","","","","","","","","",""]];const path=encPath(CONFIG.workbookPath);await graph(`/me/drive/root:${path}:/workbook/tables/${encodeURIComponent(CONFIG.tableName)}/rows/add`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({index:null,values})});$("status").textContent="Plein enregistré.";const keepFuel=$("carburant").value;$("form").reset();$("carburant").value=keepFuel;const n=new Date();$("date").value=n.toISOString().slice(0,10);$("heure").value=n.toTimeString().slice(0,5);}catch(err){$("status").textContent="ERREUR : "+err.message}};
if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");