import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from passport_parser import check_digit, parse_passport

TODAY = date(2026, 10, 13)
WANG = '''HREPUBLICOFKOREA
PASSPORT
否/Type
/Issuingcountry
ds/原
PM
KOR
M35772699
/Surname
WANG
0/Given
nam
GANG
/Nationalty
REPUBLICOFKOREA
/Dateof birth
号世/PersonalNo
28JAN 1990
1938916
M
26 MAR2018
MINISTRYOFFOREIGNAFFAIRS
72/Dateofexpiry
品民宿
26MAR2028
PMK0RNG<<GNG<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
M357726997K0R9001285M28032621938916V11089185'''
LEE = '''REPUBLICOFKOREA
PASSPORT
哥/Type
PM
KOR
M70689098
/Surname
LEE
号
SUYEON
2/Natonality
REPUBLICOFKOREA
/Dateofbirth
/Pernl No
02JUL1985
2154710
/Sex
F
Dateofisue
/Ahority
15APR2014
MINISTRY-OEFOREIGN-AFFAIRS
12/Dateofexpiry
15APR2024
0
PMKRLEE<<SUYEN<<<<<<<<<<<<<<<<<<<<<<<<<<<<
M706890985K0R8507022F24041522154710V17627884'''

class PassportParserTests(unittest.TestCase):
    def parse(self, text):
        return parse_passport(text.splitlines(), TODAY)

    def test_wang_log(self):
        r = self.parse(WANG)
        self.assertEqual([r[k] for k in ('fullName', 'birthDate', 'age', 'passportNumber', 'nationalityCode', 'sex')],
                         ['GANG WANG', '19900128', 36, 'M35772699', 'KR', 'M'])
        self.assertEqual(r['expiryDate'], '20280326')
        self.assertFalse(r['success'])
        self.assertTrue(r['needsReview'])
        self.assertFalse(r['mrzChecks']['passportNumber'])
        self.assertLess(r['confidence'], .7)

    def test_damaged_nationality_label_ends_names(self):
        r = self.parse(WANG.replace('/Nationalty', '/Nationaity'))
        self.assertEqual(r['fullName'], 'GANG WANG')

    def test_lee_log(self):
        r = self.parse(LEE)
        self.assertEqual(r['fullName'], 'SUYEON LEE')
        self.assertEqual(r['birthDate'], '19850702')
        self.assertEqual(r['age'], 41)
        self.assertEqual(r['issueDate'], '20140415')
        self.assertEqual(r['expiryDate'], '20240415')
        self.assertIn('mrz_name_structure_invalid', r['warnings'])
        self.assertNotIn('fullName', r['mrz'])
        self.assertTrue(r['needsReview'])

    def test_letters_have_icao_values(self):
        self.assertEqual(check_digit('O'), '8')
        self.assertEqual(check_digit('I'), '6')
        self.assertEqual(check_digit('Z'), '5')
        self.assertEqual(check_digit('L898902C3'), '6')

    def test_unlabelled_expiry_is_not_birth(self):
        r = self.parse('PASSPORT\nM12345678\n15APR2028')
        self.assertEqual(r['birthDate'], '')
        self.assertIsNone(r['age'])

    def test_future_birth_is_rejected(self):
        r = self.parse('PASSPORT\nDate of birth\n15APR2028\nDate of expiry\n15APR2038')
        self.assertEqual(r['birthDate'], '')
        self.assertIsNone(r['age'])

    def test_real_names_not_blacklisted(self):
        r = self.parse('PASSPORT\nSurname\nHONG\nGiven names\nKONG\nNationality\nCHN')
        self.assertEqual(r['fullName'], 'KONG HONG')

    def test_random_number_is_not_passport(self):
        r = self.parse('Receipt\nA12345678\n20260101')
        self.assertFalse(r['isPassport'])
        self.assertFalse(r['success'])
        self.assertEqual(r['passportNumber'], '')

    def test_name_conflict_not_hidden_by_valid_number(self):
        header = 'PMKORLEE<<SUYEN'.ljust(44, '<')
        r = self.parse(LEE.replace('PMKRLEE<<SUYEN<<<<<<<<<<<<<<<<<<<<<<<<<<<<', header))
        self.assertEqual(r['fullName'], 'SUYEON LEE')
        self.assertTrue(r['fieldEvidence']['fullName']['conflict'])
        self.assertTrue(r['needsReview'])

    def test_valid_sources_agree(self):
        # This specimen's second line checks correctly. Name has no checksum,
        # so require an independent visible name even with a valid MRZ header.
        header = 'PMKORLEE<<SUYEON'.ljust(44, '<')
        r = self.parse(LEE.replace('PMKRLEE<<SUYEN<<<<<<<<<<<<<<<<<<<<<<<<<<<<', header))
        self.assertTrue(r['success'])
        self.assertFalse(r['needsReview'])
        self.assertFalse(r['fieldEvidence']['sex']['checksumValid'])
        self.assertFalse(r['fieldEvidence']['nationalityCode']['checksumValid'])

    def test_country_outside_old_short_list(self):
        text = LEE.replace('K0R', 'BRA').replace('KOR', 'BRA').replace('REPUBLICOFKOREA', 'BRA')
        r = self.parse(text)
        self.assertEqual(r['nationalityCode'], 'BR')
        self.assertEqual(r['birthDate'], '19850702')

    def test_issuing_country_not_used_as_nationality(self):
        r = self.parse('PASSPORT\nIssuing country\nKOR\nNationality\nCHN')
        self.assertEqual(r['nationalityCode'], 'CN')

    def test_newborn_age_zero(self):
        r = self.parse('PASSPORT\nDate of birth\n12OCT2026')
        self.assertEqual(r['age'], 0)

    def test_bad_date_does_not_crash(self):
        r = self.parse(LEE.replace('8507022', '8513322'))
        self.assertEqual(r['birthDate'], '19850702')
        self.assertTrue(r['needsReview'])

    def test_checksum_cannot_validate_impossible_date(self):
        bad = '851332'
        r = self.parse(LEE.replace('8507022', bad + check_digit(bad)))
        self.assertEqual(r['birthDate'], '19850702')
        self.assertEqual(r['fieldEvidence']['birthDate']['status'], 'review')
        self.assertIn('mrz_birthDate_date_invalid', r['warnings'])

    def test_ambiguous_passport_numbers_are_not_guessed(self):
        r = self.parse('PASSPORT\nA12345678\nB87654321')
        self.assertEqual(r['passportNumber'], '')
        self.assertTrue(r['needsReview'])

    def test_name_containing_sex_is_not_a_label(self):
        r = self.parse('PASSPORT\nSurname\nESSEX\nGiven names\nANNA\nNationality\nGBR')
        self.assertEqual(r['fullName'], 'ANNA ESSEX')

    def test_header_without_name_separator_does_not_crash(self):
        r = self.parse('P<D<<' + 'A' * 39)
        self.assertEqual(r['fullName'], '')
        self.assertIn('mrz_name_structure_invalid', r['warnings'])

    def test_german_mrz_filler_country(self):
        header = 'P<D<<MUSTER<<ERIKA'.ljust(44, '<')
        line = 'C12345678' + check_digit('C12345678') + 'D<<8507022F2404152' + '<' * 14 + '0'
        line += check_digit(line[:10] + line[13:20] + line[21:43])
        r = self.parse(header + '\n' + line)
        self.assertEqual(r['nationalityCode'], 'DE')
        self.assertEqual(r['fullName'], 'ERIKA MUSTER')
        self.assertEqual(r['birthDate'], '19850702')

    def test_valid_mrz_still_requires_name_review_without_viz(self):
        r = self.parse('P<UTOERIKSSON<<ANNA<MARIA'.ljust(44, '<') + '\nL898902C36UTO7408122F1204159ZE184226B<<<<<10')
        self.assertEqual(r['passportNumber'], 'L898902C3')
        self.assertEqual(r['birthDate'], '19740812')
        self.assertEqual(r['fullName'], 'ANNA MARIA ERIKSSON')
        self.assertTrue(r['mrzChecks']['composite'])
        self.assertTrue(r['needsReview'])

if __name__ == '__main__':
    unittest.main()
