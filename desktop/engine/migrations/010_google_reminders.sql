-- With "Add reminders to Google Calendar" on (Settings → Connectors → Google Calendar), each upcoming reminder is also
-- an event in Clem's own "Clem" calendar in Google (calendar.app.created). This is that event's id, so cancelling the
-- reminder, or turning the option off, removes it there too.
alter table organizer_reminders add column google_event text;
