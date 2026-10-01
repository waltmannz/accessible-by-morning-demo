let selectedTime = '';
const bookingForm = document.getElementById('booking-form');
const confirmation = document.getElementById('confirmation');
const error = document.getElementById('booking-error');
document.querySelectorAll('[data-slot]').forEach(slot => {
  slot.addEventListener('click', () => {
    selectedTime = slot.dataset.slot;
    document.querySelectorAll('[data-slot]').forEach(item => item.classList.toggle('selected', item === slot));
  });
});
document.getElementById('book-appointment').addEventListener('click', event => {
  event.preventDefault();
  const name = document.getElementById('appointment-name').value.trim();
  const email = document.getElementById('appointment-email').value.trim();
  const date = document.getElementById('appointment-date').value;
  if (!name || !email || !date || !selectedTime) {
    error.textContent = 'Please enter your name, email, date, and choose an available time.';
    error.hidden = false;
    return;
  }
  if (!document.getElementById('appointment-email').validity.valid) {
    error.textContent = 'Enter an email address like alex@example.com.';
    error.hidden = false;
    return;
  }
  error.hidden = true;
  document.getElementById('confirmation-details').textContent = `${name}, your ${document.getElementById('appointment-service').value.toLowerCase()} is reserved for ${date} at ${selectedTime}.`;
  bookingForm.hidden = true;
  confirmation.hidden = false;
});
document.getElementById('book-another').addEventListener('click', () => {
  confirmation.hidden = true;
  bookingForm.hidden = false;
});
