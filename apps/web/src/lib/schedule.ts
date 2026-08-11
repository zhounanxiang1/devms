export type ScheduleDateValue = string | Date | null | undefined;

export type ProjectPlanBoundary = {
  plannedStartDate?: ScheduleDateValue;
  plannedEndDate?: ScheduleDateValue;
};

export type ScheduleRangeBoundary = {
  plannedStartDate?: ScheduleDateValue;
  plannedFinishDate?: ScheduleDateValue;
};

export function parseLocalDate(value?: ScheduleDateValue) {
  if (!value) return null;
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const input = String(value).slice(0, 10);
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatDateOnly(value?: ScheduleDateValue) {
  const date = parseLocalDate(value);
  if (!date) return "-";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function validateScheduleWithinProjectPlan(
  project: ProjectPlanBoundary | null | undefined,
  schedule: ScheduleRangeBoundary
) {
  const start = parseLocalDate(schedule.plannedStartDate);
  const finish = parseLocalDate(schedule.plannedFinishDate);
  if (!start && !finish) return "";
  const projectStart = parseLocalDate(project?.plannedStartDate);
  const projectEnd = parseLocalDate(project?.plannedEndDate);
  if (projectStart && projectEnd && projectStart.getTime() > projectEnd.getTime()) {
    return "项目计划周期异常，计划开始时间不能晚于计划结束时间";
  }
  if (start && finish && start.getTime() > finish.getTime()) {
    return "计划开始时间不能晚于计划完成时间";
  }
  if (projectStart && [start, finish].some((date) => date && date.getTime() < projectStart.getTime())) {
    return `排期不能早于项目计划开始时间：${formatDateOnly(projectStart)}`;
  }
  if (projectEnd && [start, finish].some((date) => date && date.getTime() > projectEnd.getTime())) {
    return `排期不能晚于项目计划结束时间：${formatDateOnly(projectEnd)}`;
  }
  return "";
}
