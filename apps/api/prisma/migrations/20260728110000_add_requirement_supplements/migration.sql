CREATE TABLE `RequirementSupplement` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `requirementId` INTEGER NOT NULL,
  `type` VARCHAR(191) NULL,
  `title` VARCHAR(191) NULL,
  `reason` TEXT NULL,
  `content` TEXT NULL,
  `impactScope` TEXT NULL,
  `createdById` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `RequirementSupplement_requirementId_idx`(`requirementId`),
  INDEX `RequirementSupplement_createdById_idx`(`createdById`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `RequirementSupplement`
  ADD CONSTRAINT `RequirementSupplement_requirementId_fkey`
  FOREIGN KEY (`requirementId`) REFERENCES `Requirement`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `RequirementSupplement`
  ADD CONSTRAINT `RequirementSupplement_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `Person`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
