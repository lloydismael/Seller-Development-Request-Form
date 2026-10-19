(function () {
  const relevant = b => ["Pending", "Approved", "Completed"].includes(b.status);
  const confirmed = b => ["Approved", "Completed"].includes(b.status);
  const label = type => ({ competing:"Competing requests", reserved:"Overlaps confirmed booking", confirmed:"Confirmed overlap", block:"Facilitator unavailable" }[type]);
  function find(bookings, blocks, booking, ignoreId = booking.id) {
    if (!relevant(booking) || !booking.trainingDate || !booking.facilitator) return [];
    const out = blocks.filter(block => block.facilitator === booking.facilitator && booking.trainingDate >= block.startDate && booking.trainingDate <= (block.endDate || block.startDate)).map(item => ({ type:"block", item }));
    bookings.filter(other => other.id !== ignoreId && relevant(other) && other.facilitator === booking.facilitator && other.trainingDate === booking.trainingDate && window.BookingStore.overlaps(other.time, booking.time)).forEach(item => {
      out.push({ type:confirmed(booking) && confirmed(item) ? "confirmed" : confirmed(booking) || confirmed(item) ? "reserved" : "competing", item });
    });
    return out;
  }
  function groups(bookings, blocks) {
    const affected = bookings.filter(b => find(bookings, blocks, b).length);
    const remaining = new Set(affected.map(b => b.id)), out = [];
    for (const booking of affected) {
      if (!remaining.delete(booking.id)) continue;
      const items = [booking];
      for (let i = 0; i < items.length; i++) {
        for (const conflict of find(bookings, blocks, items[i])) {
          if (conflict.type !== "block" && remaining.delete(conflict.item.id)) items.push(conflict.item);
        }
      }
      out.push({ facilitator:booking.facilitator, date:booking.trainingDate, items });
    }
    return out;
  }
  window.AdminConflicts = { find, groups, label };
})();
