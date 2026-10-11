DROP INDEX `finished_products_code_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `finished_products_name_uq` ON `finished_products` (`name`);--> statement-breakpoint
ALTER TABLE `finished_products` DROP COLUMN `code`;--> statement-breakpoint
DROP INDEX `masses_code_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `masses_name_uq` ON `masses` (`name`);--> statement-breakpoint
ALTER TABLE `masses` DROP COLUMN `code`;--> statement-breakpoint
DROP INDEX `raw_materials_code_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `raw_materials_name_uq` ON `raw_materials` (`name`);--> statement-breakpoint
ALTER TABLE `raw_materials` DROP COLUMN `code`;--> statement-breakpoint
DROP INDEX `recipes_code_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `recipes_name_uq` ON `recipes` (`name`);--> statement-breakpoint
ALTER TABLE `recipes` DROP COLUMN `code`;