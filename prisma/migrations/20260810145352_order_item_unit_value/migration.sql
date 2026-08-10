/*
  Warnings:

  - Added the required column `unitValue` to the `OrderItem` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "unitValue" DECIMAL(10,3) NOT NULL;
