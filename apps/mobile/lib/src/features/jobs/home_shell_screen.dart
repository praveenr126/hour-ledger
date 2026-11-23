import 'package:flutter/material.dart';
import '../../../l10n/app_localizations.dart';
import '../../core/theme/app_theme.dart';
import '../profile/profile_models.dart';
import '../profile/verified_profile_screen.dart';
import 'browse_jobs_screen.dart';
import 'my_jobs_screen.dart';
import 'post_job_screen.dart';

class HomeShellScreen extends StatefulWidget {
  const HomeShellScreen({super.key, required this.profile});

  final UserProfile profile;

  @override
  State<HomeShellScreen> createState() => _HomeShellScreenState();
}

class _HomeShellScreenState extends State<HomeShellScreen> {
  int _selectedIndex = 0;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;

    final screens = <Widget>[
      const BrowseJobsScreen(),
      const MyJobsScreen(),
      const PostJobScreen(),
      VerifiedProfileScreen(profile: widget.profile),
    ];

    return Scaffold(
      body: IndexedStack(
        index: _selectedIndex,
        children: screens,
      ),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: AppTokens.hairline, width: 1.0)),
        ),
        child: NavigationBar(
          selectedIndex: _selectedIndex,
          onDestinationSelected: (idx) => setState(() => _selectedIndex = idx),
          destinations: <NavigationDestination>[
            NavigationDestination(
              key: const Key('nav_browse_tab'),
              icon: const Icon(Icons.work_outline),
              label: l10n.tabBrowse,
            ),
            NavigationDestination(
              key: const Key('nav_my_jobs_tab'),
              icon: const Icon(Icons.assignment_outlined),
              label: l10n.tabMyJobs,
            ),
            NavigationDestination(
              key: const Key('nav_post_job_tab'),
              icon: const Icon(Icons.add_circle_outline),
              label: l10n.tabPostJob,
            ),
            NavigationDestination(
              key: const Key('nav_wallet_tab'),
              icon: const Icon(Icons.account_balance_wallet_outlined),
              label: l10n.tabWalletProfile,
            ),
          ],
        ),
      ),
    );
  }
}
