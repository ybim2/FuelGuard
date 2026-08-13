# Fuel Guard Activity Logger — Connect IQ Store listing

## Listing fields

- **App name:** Fuel Guard Activity Logger
- **Version:** 0.5.5
- **App type:** Data Field
- **Category:** Health & Fitness
- **Language:** English
- **Public endpoint:** `https://fuelguardapp.com`
- **Privacy policy:** `https://fuelguardapp.com/privacy/`
- **Release channel:** Public beta

## Short description

Record Fuel Guard fuelling events while you train.

## Full description

Fuel Guard Activity Logger is a Garmin Data Field for recording a Fuel Guard Fuel event during a native Garmin activity such as Run or Bike.

Install the Data Field, connect it to your Fuel Guard athlete account, then add it to a supported activity profile. The current public-beta interaction records Fuel when Garmin emits a LAP event. The watch acknowledges the action, and the event syncs into the athlete's normal Fuel Guard Daily timeline.

When Training Mode is active in Fuel Guard, the same event also inherits the active workout context and configured Fuel preset values. Temporary connection failures are queued using a stable event identity so retry or sync does not create a duplicate event.

This version records Fuel only. It does not have a separate in-activity Hydration button.

On devices where Connect IQ exposes only the generic LAP callback—including the Forerunner 255—the Data Field cannot distinguish a manual lap from Auto Lap or another lap source. Disable Auto Lap before use, and be aware that structured-workout laps may also be interpreted as Fuel events. Each action remains a normal Garmin lap.

A Fuel Guard account and the Connect IQ Store mobile app are required for account connection. The phone approval notification is handled by Connect IQ Store.

This is a public beta. Please report connection or device-layout problems using the developer contact on this listing.

## Store highlights

- Garmin Data Field for native activities
- LAP interaction records one Fuel event
- Normal Fuel Guard Daily timeline sync
- Training Mode context and Fuel-preset enrichment
- Durable offline queue with duplicate protection
- Revocable account connection

## Store assets

- 500 × 500 icon: `assets/activity-logger/store-icon-500.png`
- Screenshots: add representative simulator/physical-watch captures to `assets/activity-logger/` before submission.
- Recommended screenshot order: field setup/connect screen; connected field; in-activity field; `FUEL LOGGED` acknowledgement.

Do not submit until every asset has been reviewed at the dimensions shown by the Connect IQ developer portal and the public support contact has been confirmed.
