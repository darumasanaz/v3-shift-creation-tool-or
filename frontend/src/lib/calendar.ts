export type DayType = 'bathDay' | 'normalDay' | 'wednesday';

export const calcMonthMeta = (year: number, month1to12: number) => {
  const targetYear = Number.isFinite(year) ? Math.trunc(year) : new Date().getFullYear();
  const monthIndex = Number.isFinite(month1to12) ? Math.trunc(month1to12) : new Date().getMonth() + 1;
  const normalizedMonth = Math.min(Math.max(monthIndex, 1), 12);
  const days = new Date(targetYear, normalizedMonth, 0).getDate();
  const weekdayOfDay1 = new Date(targetYear, normalizedMonth - 1, 1).getDay();
  const dayTypeByDate: DayType[] = [];
  for (let day = 1; day <= days; day += 1) {
    const weekday = new Date(targetYear, normalizedMonth - 1, day).getDay();
    const isWeekend = weekday === 0 || weekday === 6;
    if (isWeekend) {
      dayTypeByDate.push('normalDay');
    } else if (weekday === 3) {
      dayTypeByDate.push('wednesday');
    } else {
      dayTypeByDate.push('bathDay');
    }
  }
  return { days, weekdayOfDay1, dayTypeByDate };
};
