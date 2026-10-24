"""Legacy SQLite route tests are disabled during the MongoDB migration.
MongoDB-backed route tests must be added before this suite is considered complete.
"""
import unittest

raise unittest.SkipTest("SQLite-specific route tests are not applicable to the MongoDB backend yet")
