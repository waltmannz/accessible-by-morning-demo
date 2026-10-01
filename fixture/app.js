let selectedTime = '';
const bookingForm = document.getElementById('booking-form');
const confirmation = document.getElementById('confirmation');
const error = document.getElementById('booking-error');
const dateInput = document.getElementById('appointment-date');
const nameInput = document.getElementById('appointment-name');
const emailInput = document.getElementById('appointment-email');
const serviceInput = document.getElementById('appointment-service');
const slotButtons = document.querySelectorAll('[data-slot]');

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

slotButtons.forEach(slot => {
  slot.addEventListener('click', () => {
    selectedTime = slot.dataset.slot;
    slotButtons.forEach(item => {
      const isSelected = item === slot;
      item.classList.toggle('selected', isSelected);
      item.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    });
  });
});

bookingForm.addEventListener('submit', event => {
  event.preventDefault();
  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const date = dateInput.value;
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const localToday = getLocalDateString();

  if (!name || !email || !date || !selectedTime) {
    error.textContent = 'Please enter your name, email, date, and choose an available time.';
    error.hidden = false;
    error.focus?.();
    return;
  }
  if (!emailPattern.test(email)) {
    error.textContent = 'Enter an email address like alex@example.com.';
    error.hidden = false;
    emailInput.focus();
    return;
  }
  if (date <= localToday) {
    error.textContent = 'Please select a future appointment date.';
    error.hidden = false;
    dateInput.focus();
    return;
  }

  error.hidden = true;
  error.textContent = '';
  document.getElementById('confirmation-details').textContent = `${name}, your ${serviceInput.value.toLowerCase()} is reserved for ${date} at ${selectedTime}.`;
  bookingForm.hidden = true;
  confirmation.hidden = false;
  confirmation.focus();
});

document.getElementById('book-another').addEventListener('click', () => {
  confirmation.hidden = true;
  bookingForm.hidden = false;
  nameInput.value = '';
  emailInput.value = '';
  selectedTime = '';
  slotButtons.forEach(item => {
    item.classList.remove('selected');
    item.setAttribute('aria-pressed', 'false');
  });
  error.hidden = true;
  error.textContent = '';
  serviceInput.focus();
});
