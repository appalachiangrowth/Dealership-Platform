/* Public lead sender: vehicle request form + contact form -> api/lead.php (saved for the dealer + emailed).
   Keeps the PA_BRIDGE names the original scripts use. */
(function () {
  "use strict";
  var B = window.PA_BRIDGE = window.PA_BRIDGE || {};
  B.ready = true;
  B.sendLead = function (o) {
    return fetch("api/lead.php", {method: "POST", headers: {"Content-Type": "application/json"}, credentials: "same-origin", cache: "no-store", body: JSON.stringify(o)})
      .then(function (r) {return r.json();})
      .then(function (j) {return {ok: !!(j && j.ok)};})
      .catch(function () {return {ok: false};});
  };
  B.leadFromForm = function (msg) {
    return B.sendLead({name: msg.name, email: msg.email, phone: msg.phone, topic: msg.topic, message: msg.message, page: location.href, vehicleId: msg.vehicleId || "", _honey: ""});
  };
})();
