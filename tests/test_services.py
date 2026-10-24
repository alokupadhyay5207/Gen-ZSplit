"""Legacy SQLite service tests are disabled during the MongoDB migration.
MongoDB-backed service tests must be added before this suite is considered complete.
"""
import unittest

raise unittest.SkipTest("SQLite-specific service tests are not applicable to the MongoDB backend yet")
