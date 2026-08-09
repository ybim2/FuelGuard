const { invitationEmailHandler } = require("../../lib/transactional-email.js");

module.exports = (request, response) => invitationEmailHandler(request, response);
