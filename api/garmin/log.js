const { garminLogHandler, garminTrainingHandler } = require("../../lib/garmin-auth.js");

async function garminEndpointHandler(request, response) {
  if (request.query?.fuel_guard_action === "training") {
    return garminTrainingHandler(request, response);
  }
  return garminLogHandler(request, response);
}

module.exports = garminEndpointHandler;
module.exports.garminTrainingHandler = garminTrainingHandler;
