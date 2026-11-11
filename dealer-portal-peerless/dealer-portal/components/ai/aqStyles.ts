/** Look of the AI Quick Add screens (from the AI Quick Add v4.2 design), scoped to .aq */
export const AQ_CSS = `
.aq .top{background:#fff;border-bottom:1px solid #E5E9F0;padding:18px 28px;display:flex;flex-wrap:wrap;align-items:center;gap:16px}
.aq .top h1{margin:0;font-size:26px;letter-spacing:-.02em}
.aq .top p{margin:4px 0 0;color:#526077}
.aq .wrap{padding:24px 28px 40px;display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start;max-width:1320px;width:100%}
.aq .col{flex:999 1 560px;min-width:0;display:flex;flex-direction:column;gap:20px}
.aq .panel{flex:1 1 300px;min-width:0;position:sticky;top:20px;display:flex;flex-direction:column;gap:16px}
.aq .card{background:#fff;border:1px solid #E5E9F0;border-radius:14px;box-shadow:0 1px 2px rgba(15,23,42,.05)}
.aq .hd{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid #E5E9F0}
.aq .num{width:32px;height:32px;border-radius:8px;background:#EAF1FF;color:#1D4ED8;display:flex;align-items:center;justify-content:center;font-weight:700;flex:none}
.aq .num.ok{background:#E8F7EE;color:#15803D}
.aq .hd h2{margin:0;font-size:16px}
.aq .hd p{margin:2px 0 0;font-size:13px;color:#526077}
.aq .bd{padding:20px;display:flex;flex-direction:column;gap:14px}
.aq .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:18px 16px}
.aq .f{display:flex;flex-direction:column;gap:6px;min-width:0;scroll-margin-top:20px}
.aq .f.wide{grid-column:span 2}
.aq .f.full{grid-column:1/-1}
.aq .lr{display:flex;align-items:center;gap:4px;min-height:24px;flex-wrap:wrap}
.aq .lbl{font-size:13px;font-weight:600;color:#1E293B}
.aq .req{color:#B91C1C;font-weight:700}
.aq .fld{display:flex;align-items:stretch;border:1px solid #CBD5E1;border-radius:8px;background:#fff;min-height:42px;overflow:hidden}
.aq .fld:focus-within{border-color:#2563EB;box-shadow:0 0 0 3px rgba(37,99,235,.18)}
.aq .fld.ai{border-color:#C4B5FD;background:#FBFAFF}
.aq .fld.unsure{border-color:#FCD34D;background:#FFFDF5}
.aq .fld.miss{border-color:#FCA5A5}
.aq .fld input,.aq .fld select,.aq .fld textarea{flex:1;min-width:0;border:0;outline:0;background:transparent;padding:0 12px}
.aq .fld textarea{padding:10px 12px;min-height:110px;resize:vertical;line-height:1.5}
.aq .pre{display:flex;align-items:center;padding:0 0 0 12px;color:#526077;font-weight:500}
.aq .suf{display:flex;align-items:center;padding:0 12px 0 0;color:#526077;font-weight:500}
.aq .mono{font-family:ui-monospace,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase}
.aq .hint{font-size:12px;color:#526077}
.aq .ev{font-size:12px;color:#5B3FD6}
.aq .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:42px;padding:0 16px;border-radius:8px;border:1px solid #CBD5E1;background:#fff;font-weight:600;cursor:pointer;white-space:nowrap}
.aq .btn:hover{background:#F8FAFC}
.aq .btn.p{background:#2563EB;border-color:#2563EB;color:#fff}
.aq .btn.p:hover{background:#1D4ED8}
.aq .btn:disabled{opacity:.5;cursor:not-allowed}
.aq .btn.sm{min-height:32px;padding:0 10px;font-size:12.5px}
.aq .btn.big{min-height:50px;font-size:16px;padding:0 26px}
.aq .link{background:none;border:0;padding:0;color:#1D4ED8;font-weight:600;cursor:pointer}
.aq .chip{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:999px;white-space:nowrap}
.aq .s-vin{background:#EAF1FF;color:#1D4ED8}
.aq .s-ai{background:#F1EDFF;color:#5B3FD6}
.aq .s-unsure{background:#FEF3C7;color:#92400E}
.aq .s-you{background:#E8F7EE;color:#15803D}
.aq .s-auto{background:#F1F5F9;color:#475569}
.aq .s-miss{background:#FEE2E2;color:#B91C1C}
.aq .s-ok{background:#E8F7EE;color:#15803D}
.aq .okbtn{border:1px solid #C4B5FD;background:#fff;color:#5B3FD6;border-radius:999px;font-size:11.5px;font-weight:700;padding:2px 9px;cursor:pointer}
.aq .okbtn.done{background:#16A34A;border-color:#16A34A;color:#fff}
.aq .note{display:flex;gap:10px;padding:12px 14px;border-radius:10px;font-size:13px;line-height:1.5}
.aq .n-info{background:#EFF6FF;color:#1E3A8A;border:1px solid #DBE7FE}
.aq .n-ok{background:#E8F7EE;color:#14532D;border:1px solid #BBE5CB}
.aq .n-warn{background:#FFFBEB;color:#78350F;border:1px solid #FDE68A}
.aq .n-bad{background:#FEF2F2;color:#7F1D1D;border:1px solid #FECACA}
.aq .tip{position:relative;display:inline-flex}
.aq .tipb{width:22px;height:22px;border:0;padding:0;border-radius:50%;background:transparent;color:#64748B;cursor:help;display:inline-flex;align-items:center;justify-content:center}
.aq .tipb:hover,.aq .tipb:focus-visible{color:#1D4ED8;background:#EAF1FF;outline:0}
.aq .tipx{display:none;position:absolute;left:-10px;bottom:calc(100% + 8px);width:260px;padding:10px 12px;border-radius:8px;background:#0F172A;color:#F1F5F9;font-size:12.5px;font-weight:400;line-height:1.5;z-index:40;box-shadow:0 8px 24px rgba(15,23,42,.25)}
.aq .tip:hover .tipx,.aq .tip:focus-within .tipx{display:block}
.aq .seg{display:inline-flex;gap:2px;padding:4px;border-radius:10px;background:#EEF1F6}
.aq .segb{min-height:36px;padding:0 16px;border-radius:7px;border:0;background:transparent;font-weight:600;cursor:pointer;color:#334155}
.aq .segb.on{background:#fff;color:#1D4ED8;box-shadow:0 1px 2px rgba(15,23,42,.12)}
.aq .drop{border:1.5px dashed #CBD5E1;border-radius:12px;background:#F8FAFC;padding:22px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px}
.aq .drop.over{border-color:#2563EB;background:#EFF6FF}
.aq .thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:10px}
.aq .th{position:relative;border-radius:10px;overflow:hidden;aspect-ratio:4/3;background:#E2E8F0}
.aq .th img{width:100%;height:100%;object-fit:cover;display:block}
.aq .th .n{position:absolute;left:6px;top:6px;background:#0F172A;color:#fff;font-size:11px;font-weight:700;padding:2px 7px;border-radius:999px}
.aq .th .x,.aq .th .c{position:absolute;top:6px;width:26px;height:26px;border-radius:50%;border:0;background:rgba(255,255,255,.95);cursor:pointer;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center}
.aq .th .x{right:6px}
.aq .th .c{right:36px}
.aq .th{cursor:grab}
.aq .th.drag{opacity:.4}
.aq .th.over{outline:3px solid #2563EB;outline-offset:2px}
.aq .th .ang{position:absolute;left:6px;bottom:6px;background:rgba(15,23,42,.78);color:#fff;font-size:10.5px;font-weight:600;padding:2px 7px;border-radius:999px;max-width:calc(100% - 70px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.aq .th .tb{position:absolute;right:6px;bottom:6px;display:flex;gap:4px}
.aq .th .tb button{width:26px;height:26px;border-radius:50%;border:0;background:rgba(255,255,255,.95);cursor:pointer;font-size:11px}
.aq .ai-bar{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;font-size:13px;font-weight:600}
.aq .spin{width:16px;height:16px;border:2px solid #DDD6FE;border-top-color:#5B3FD6;border-radius:50%;animation:aqspin .8s linear infinite;flex:none}
.aq .spin.w{border-color:rgba(255,255,255,.4);border-top-color:#fff}
@keyframes aqspin{to{transform:rotate(360deg)}}
.aq .miss-item{display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:8px;cursor:pointer;width:100%;border:0;background:none;text-align:left}
.aq .miss-item:hover{background:#F1F5F9}
.aq .dot{width:16px;height:16px;border-radius:50%;border:2px solid #CBD5E1;flex:none}
.aq .dot.ai{border-color:#A78BFA}
.aq .dot.warn{border-color:#F59E0B;background:#FEF3C7}
.aq .miss-item .dot{border-color:#FCA5A5}
.aq .miss-item .dot.warn{border-color:#F59E0B;background:#FEF3C7}
.aq .modal{position:fixed;inset:0;background:rgba(15,23,42,.5);display:flex;align-items:center;justify-content:center;padding:20px;z-index:50}
.aq .modal .card{max-width:640px;width:100%;max-height:90vh;overflow:auto}
.aq .hidden{display:none!important}
.aq .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.aq details summary{cursor:pointer;font-weight:600;font-size:13px}
@keyframes aqpulse{50%{box-shadow:0 0 0 6px rgba(239,68,68,.15)}}
.aq .btn.ai{background:#5B3FD6;border-color:#5B3FD6;color:#fff}
.aq .btn.ai:hover{background:#4C33B8}
.aq .modes{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.aq .modeb{display:flex;gap:14px;align-items:flex-start;text-align:left;padding:16px;border-radius:12px;border:1.5px solid #E5E9F0;background:#fff;cursor:pointer}
.aq .modeb:hover{border-color:#93B4F5}
.aq .modeb.on{border-color:#2563EB;background:#F5F8FF;box-shadow:0 0 0 3px rgba(37,99,235,.12)}
.aq .modeb .ic{font-size:26px;line-height:1}
.aq .steps{display:flex;flex-direction:column;gap:6px}
.aq .stp{display:flex;align-items:center;gap:10px;font-size:13.5px;color:#94A3B8}
.aq .stp.run{color:#5B3FD6;font-weight:600}
.aq .stp.ok{color:#15803D}
.aq .stp.err{color:#B91C1C}
.aq .stp .b{width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:#F1F5F9;flex:none}
.aq .stp.ok .b{background:#E8F7EE}
.aq .stp.err .b{background:#FEE2E2}
.aq .film li{margin:5px 0}
.aq .guide{border:1px solid #DBE5F5;background:#F5F9FF;border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:10px;font-size:13.5px;color:#1E293B}
.aq .g-top{display:flex;flex-direction:column;gap:2px}
.aq .g-top b{font-size:14.5px}
.aq .g-rules{display:flex;flex-wrap:wrap;gap:6px}
.aq .g-rules span{background:#fff;border:1px solid #DBE5F5;border-radius:999px;padding:4px 10px;font-size:12.5px}
.aq .g-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}
.aq .g-col{background:#fff;border:1px solid #E5E9F0;border-radius:10px;padding:10px 12px}
.aq .g-col h4{margin:0 0 2px;font-size:13.5px}
.aq .g-col ol{margin:0;padding-left:20px}
.aq .g-say{background:#fff;border:1px dashed #C7D2FE;border-radius:10px;padding:8px 12px}
.aq .vmode .drop,.aq .vmode .note.n-info{display:none}
.aq .mono{font-family:ui-monospace,Menlo,monospace}
.aq{font-size:14px;line-height:1.45;color:#0F172A}
.aq button,.aq input,.aq select,.aq textarea{font:inherit;color:inherit}
.aq .top{margin:-24px -16px 0;padding:18px 16px}
@media (min-width:640px){.aq .top{margin:-28px -28px 0;padding:18px 28px}}
.aq .wrap{padding:24px 0 40px;max-width:none}
.aq .panel{top:16px}
.aq .ev{white-space:pre-line}
.aq .thumbs .th .tb button:hover,.aq .th .x:hover,.aq .th .c:hover{background:#fff;box-shadow:0 0 0 2px #2563EB}
.aq .modal .card{max-width:520px}
@media (max-width:640px){.aq .f.wide{grid-column:auto}}
`;
