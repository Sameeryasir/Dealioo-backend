import { BadRequestException } from '@nestjs/common';
import { AdSetPlacementsDto } from './dto/save-adset-step.dto';
import { MetaCampaignObjective, MetaOptimizationGoal } from './meta-campaign.constants';
import { isOptimizationGoalValidForObjective } from './meta-adset-objectives';

export function budgetToMetaMinorUnits(dollars: number): string {
  const cents = Math.round(dollars * 100);
  if (cents < 100) {
    throw new BadRequestException(
      'Budget must be at least 1.00 in account currency.',
    );
  }
  return String(cents);
}

export function combineDateAndTime(
  date: string,
  time: string,
  timezone: string,
): string {
  const trimmedDate = date.trim();
  const trimmedTime = time.trim();
  const trimmedTz = timezone.trim();

  if (!trimmedDate || !trimmedTime || !trimmedTz) {
    throw new BadRequestException('Schedule date, time, and timezone are required.');
  }

  const isoCandidate = `${trimmedDate}T${trimmedTime}:00`;
  const parsed = Date.parse(isoCandidate);
  if (!Number.isFinite(parsed)) {
    throw new BadRequestException('Invalid schedule date or time.');
  }

  return `${isoCandidate} (${trimmedTz})`;
}

export function assertScheduleOrder(startDateTime: string, endDateTime: string): void {
  const start = Date.parse(startDateTime.split(' (')[0]);
  const end = Date.parse(endDateTime.split(' (')[0]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new BadRequestException('Invalid schedule.');
  }
  if (end <= start) {
    throw new BadRequestException('End date/time must be after start date/time.');
  }
}

export function assertAtLeastOnePlacement(placements: AdSetPlacementsDto): void {
  if (placements.advantagePlusPlacements) {
    return;
  }

  const hasDevice =
    placements.devicePlatforms.mobile || placements.devicePlatforms.desktop;

  const hasPublisher =
    placements.publisherPlatforms.facebook ||
    placements.publisherPlatforms.instagram ||
    placements.publisherPlatforms.audienceNetwork ||
    placements.publisherPlatforms.messenger;

  const hasFacebookPosition = Object.entries(placements.facebookPositions).some(
    ([, enabled]) => enabled,
  );
  const hasInstagramPosition = Object.entries(
    placements.instagramPositions,
  ).some(([, enabled]) => enabled);

  if (!hasDevice || !hasPublisher || (!hasFacebookPosition && !hasInstagramPosition)) {
    throw new BadRequestException(
      'Select at least one device, publisher platform, and ad position — or enable Advantage+ Placements.',
    );
  }
}

export function assertOptimizationGoalForObjective(
  objective: MetaCampaignObjective,
  optimizationGoal: MetaOptimizationGoal,
): void {
  if (!isOptimizationGoalValidForObjective(objective, optimizationGoal)) {
    throw new BadRequestException(
      `Optimization goal ${optimizationGoal} is not valid for campaign objective ${objective}.`,
    );
  }
}

export function assertAudienceCityRadius(
  city: string | undefined,
  radius: number | undefined,
  distanceUnit: string | undefined,
): void {
  if (city?.trim() && (!radius || !distanceUnit)) {
    throw new BadRequestException(
      'City targeting requires radius and distance unit.',
    );
  }
}
