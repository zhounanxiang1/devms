ALTER TABLE `ReleaseVersion` ADD COLUMN `createdById` INTEGER NULL;

ALTER TABLE `ReleaseVersion`
  ADD CONSTRAINT `ReleaseVersion_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `Person`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
