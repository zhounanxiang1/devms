ALTER TABLE `Requirement`
  ADD COLUMN `pmAcceptanceConclusion` TEXT NULL,
  ADD COLUMN `pmAcceptedAt` DATETIME(3) NULL,
  ADD COLUMN `pmAcceptorId` INTEGER NULL,
  ADD COLUMN `uiAcceptanceConclusion` TEXT NULL,
  ADD COLUMN `uiAcceptedAt` DATETIME(3) NULL,
  ADD COLUMN `uiAcceptorId` INTEGER NULL;

ALTER TABLE `Requirement`
  ADD CONSTRAINT `Requirement_pmAcceptorId_fkey`
  FOREIGN KEY (`pmAcceptorId`) REFERENCES `Person`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Requirement`
  ADD CONSTRAINT `Requirement_uiAcceptorId_fkey`
  FOREIGN KEY (`uiAcceptorId`) REFERENCES `Person`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
